/**
 * Shared types for schedules and content.
 *
 * Kept in its own file so content modules can import `PollSpec` without
 * creating an import cycle with `schedules.ts` (which imports content).
 */

/** A single anonymous poll definition (the nightly self-review). */
export interface PollSpec {
  /** Telegram allows ≤300 chars; tests cap at 255 for a safe margin. */
  question: string;
  /** 2..10 options, each ≤100 chars. lib/post.ts maps these to the
   *  InputPollOption objects Bot API 7.3+ expects. */
  options: readonly string[];
  /** Anonymous by default — nobody (not even the bot) sees who voted,
   *  only aggregate percentages. Keep true: it's the whole point. */
  isAnonymous?: boolean;
  /** Allow ticking several deeds in one vote. Defaults to true. */
  allowsMultipleAnswers?: boolean;
  /** Hours until Telegram auto-closes the poll. Clamped to Telegram's
   *  5s..~30d window in lib/post.ts. Default 22h. */
  closeAfterHours?: number;
}

interface BaseSchedule {
  /** Unique, short id. Used in logs and `/admin_run <name>`. */
  name: string;
  /**
   * Standard 5-field cron, interpreted in TZ_NAME. Day-of-week:
   * 0 or 7 = Sunday, 1 = Monday, ... 5 = Friday, 6 = Saturday.
   */
  cron: string;
  /** Human note shown in `/admin_health`. Optional. */
  description?: string;
  /**
   * Ring-buffer size: how many of this schedule's past posts stay live.
   * After each fire, older posts (oldest first) are deleted.
   *   - omit ⇒ 1 for messages (replace-on-next-fire), 0 for polls.
   *   - 0 ⇒ never track, never delete (one-off announcements).
   *   - 1 ⇒ exactly one live copy.
   *   - N>1 ⇒ keep the latest N.
   */
  keepLast?: number;
  /**
   * Optional fire-time guard. If it returns true the fire is skipped:
   * nothing is posted and the ring buffer is left untouched (same effect
   * as empty content). Pure function of `now` so it stays unit-testable.
   * Used by fasting_reminder to suppress the Mon/Thu nudge when TOMORROW
   * is a day nafl fasting is forbidden (Eid / أيام التشريق) — see
   * lib/hijri.ts. Adding it here (not as a name check in the scheduler)
   * keeps "a new schedule needs no framework change" intact.
   */
  skipIf?: (now: Date) => boolean;
  /**
   * Post silently (Telegram disable_notification): the message still
   * appears in the channel, but the reader's device does not make a sound
   * or vibrate. Used for the "rider" posts that are co-scheduled a minute
   * after an anchor (Friday sunnah after the morning azkar; the fasting
   * nudge and pre-sleep dhikr before the night poll), so each session is a
   * single ping. Defaults to false (the post rings). See schedules.ts.
   */
  silent?: boolean;
}

/** Posts a text message. `content` may be a fixed string or, if an
 *  array, one entry is picked at random per fire (see lib/pick.ts). */
export interface MessageSchedule extends BaseSchedule {
  kind: 'message';
  content: string | readonly string[];
  /**
   * Opt into a Telegram parse_mode for THIS message. Omitted (the default)
   * means plain text, the Arabic-safe norm the whole bot uses. The three
   * long azkar set 'HTML' for a bold title only (body stays normal-size);
   * their content is built by azkarHtml(), which escapes & < >.
   * See content/format.ts and the "no parse_mode" note in CLAUDE.md.
   */
  parseMode?: 'HTML' | 'MarkdownV2' | 'Markdown';
  /**
   * Optional inline-keyboard URL buttons shown under the message. Each inner
   * array is one row of buttons. Channels only allow inline keyboards, and
   * URL buttons cost nothing against the 4096-char limit. Used to link the
   * suras the message references (e.g. «اقرأ سورة المُلك») — the bot points
   * to Quran, it never reproduces it. Attached right after posting via
   * editMessageReplyMarkup, so the kit's post() stays the single send path; a
   * failure is logged and non-fatal (the button-less message still stands).
   * See scheduler.ts#attachButtons.
   */
  buttons?: readonly (readonly { text: string; url: string }[])[];
}

/** Sends one anonymous poll. `poll` may be a fixed spec or a factory
 *  called at fire time, so the night review can vary by day-of-week
 *  (Mon/Thu add a fasting option) while one schedule + one state key
 *  keeps the replace-on-next-fire cleanup intact. See content/poll.ts. */
export interface PollSchedule extends BaseSchedule {
  kind: 'poll';
  poll: PollSpec | (() => PollSpec);
}

export type ScheduleDef = MessageSchedule | PollSchedule;
