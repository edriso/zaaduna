import type { PollSpec } from '../types';
import { config } from '../config';
import { noFastReason } from '../lib/hijri';

/**
 * The nightly self-review poll: anonymous + multiple-answer, so nobody
 * (not even the bot) sees who voted — only aggregate percentages. No DB,
 * no riya.
 *
 * Built per fire by buildNightReviewPoll. Three kinds of option:
 *   - A FIXED daily-worship core (CORE_WAKE + CORE_NIGHT) shown EVERY night —
 *     the "initial" essentials you review daily (fajr, morning/evening
 *     adhkar, Qur'an, duha, khushūʿ + post-prayer dhikr, istighfar, qiyam,
 *     Mulk + sleep adhkar). These never rotate out, so the core is always
 *     covered.
 *   - One ROTATING أخلاق/قلب self-check (AKHLAQ_CHECKS) and one ROTATING بِرّ
 *     (حقوق العباد) deed (BIRR_DEEDS) — one of EACH per night. They rotate
 *     once per poll night, so a WIDER set of character + dealing-with-people
 *     topics is reviewed across the days, without the list ever growing. The
 *     two pools have different lengths, so their pairing varies over time too.
 *   - Day-specific extras from OPTIONS_BY_DAY (Mon/Thu add a صيام option).
 * So the list is 10 most nights, 11 on Mon/Thu. Adding a day-specific list
 * later (e.g. Friday) is one entry in that table — no branching in the
 * function, and one schedule + one state key keeps replace-on-next-fire intact.
 *
 * Telegram limits: question ≤300 chars, 2..12 options (the cap was raised
 * from 10 to 12 in Bot API 9.1, Jul 2025), each ≤100. Keep the emoji at the
 * END of each string (a leading emoji collides with the vote %/count Telegram
 * appends) and leave a little margin — rtlIsolate in lib/post.ts adds 2 chars.
 *
 * Framing — TODAY *and* tomorrow: it is a محاسبة for today AND a نيّة for the
 * coming day ("tick what you did today; what you missed, resolve for
 * tomorrow"), so a reader who opens it late, or who wants to commit for
 * tomorrow, still benefits. Every option is an HONEST effort you can tick
 * without lying or feeling defeated («ولو ركعتين», «أدومها وإن قلّ»), not a
 * claim of perfection.
 */

const QUESTION =
  'محاسبةُ اليوم ونيّةُ الغد (سرّي مجهول): أشِّر على ما وفّقك الله إليه اليوم، وما فاتك فاعزِم عليه غدًا بإذنه؛ نتنافس في الخير ويشجّع بعضنا بعضًا 📋';

// The FIXED daily-worship core, split around the rotating self-checks (see
// header). These "initial" essentials show every night, in this order.
const CORE_WAKE: readonly string[] = [
  'أذكار الاستيقاظ ثم صلاة الفجر في وقتها ⏰',
  'أذكار الصباح والمساء 🛡️',
  'ورد القرآن (ولو صفحة) 🔖',
  'صلاة الضحى ولو ركعتين ☀️',
];
const CORE_NIGHT: readonly string[] = [
  'اجتهدت في خشوع صلاتي وطمأنينتها، وقُلت أذكار ما بعد الصلاة المفروضة 🕌',
  'استغفار ١٠٠ مرّة 📿',
  'قيام الليل ولو ركعتين ✨',
  'سورة المُلك وأذكار النوم 🌙',
];

/** An extra option spliced into the base list on a given night. */
interface DayOption {
  /** Option text (emoji at the END; stay under 100 chars). */
  option: string;
  /**
   * Insert right AFTER the base option equal to this text, so the extra
   * lands at its intended spot in the order. Omit to append. An unknown
   * anchor throws — a typo fails the tests instead of shipping a
   * misordered poll.
   */
  after?: string;
  /**
   * Mark a "did you fast?" option. These are removed on days nafl fasting
   * is forbidden (Eid / أيام التشريق) — there was no fast to tick. Set it
   * on any future fasting extra; non-fasting day options stay untouched.
   */
  fasting?: boolean;
}

// Insert fasting after خشوع الصلاة (first of CORE_NIGHT), before the
// istighfar/qiyam/sleep cluster — its spot in the day's worship.
const FASTING_ANCHOR = 'اجتهدت في خشوع صلاتي وطمأنينتها، وقُلت أذكار ما بعد الصلاة المفروضة 🕌';

// ROTATING أخلاق/قلب self-check — one per poll night, so different character
// and heart topics come up on different days (the لسان/غضب check is the first
// here, so it is still covered, just not every single night). Emoji at the
// END; each < 100 chars after rtlIsolate's +2. Exported for tests.
export const AKHLAQ_CHECKS: readonly string[] = [
  'حفظتُ لساني عن الغِيبة والكلام الجارح 🤍',
  'تمالكتُ نفسي عند الغضب، ولِنتُ لمن حولي 🌿',
  'صدَقتُ في كلامي، ووفّيتُ بما وعدت 💬',
  'أحسنتُ الظنّ بالناس، ولم أتتبّع عيوبهم 🕊️',
  'تركتُ اللغوَ وما لا يعنيني، وكَفَفتُ عن الجدال 🤫',
  'راقبتُ الله في خَلوتي، وأخلصتُ نيّتي له 💫',
  'تواضعتُ ولم أحتقر أحدًا، وقبِلتُ الحقّ 🍃',
];

// ROTATING بِرّ (حقوق العباد) deed — one per poll night, so the review covers
// dealing with people across the days: صدقة، إطعام، صلة رحم، تفريج كربة، برّ
// الوالدين، عيادة مريض / إماطة أذى. Exported for tests.
export const BIRR_DEEDS: readonly string[] = [
  'تصدّقتُ اليوم ولو بالقليل 💝',
  'أطعمتُ طعامًا أو سقيتُ، أو أعنتُ محتاجًا 🍲',
  'وصلتُ رحمًا، أو سألتُ عن قريبٍ أو صديق 📞',
  'نفّستُ كربةَ مهموم، أو قضيتُ حاجةَ أحد 🤝',
  'بَرَرتُ والديّ، أو أدخلتُ السرورَ عليهما 💞',
  'عُدتُ مريضًا، أو أمَطتُ أذًى عن الطريق 🌸',
];

/**
 * Pick the rotating slot for a given poll night. The poll fires every other
 * night (isPollNight keys off dayNumberInTz parity), so dividing the day
 * number by 2 advances by exactly one per fire and walks the whole pool in
 * order. tz-keyed and stateless, same discipline as isPollNight — a given
 * poll night always shows the same pick, consecutive poll nights differ, and
 * because AKHLAQ_CHECKS and BIRR_DEEDS have different lengths their pairing
 * varies over time too.
 */
function rotateForNight<T>(pool: readonly T[], now: Date, tz: string): T {
  return pool[Math.floor(dayNumberInTz(now, tz) / 2) % pool.length];
}

// Weekday in TZ_NAME (0=Sun..6=Sat) → options to add that night. THE
// EDIT POINT for day variants: add a key (e.g. 5 for a Friday list) here;
// buildNightReviewPoll needs no change.
const OPTIONS_BY_DAY: Record<number, readonly DayOption[]> = {
  1: [{ option: 'صيام الاثنين 🌒', after: FASTING_ANCHOR, fasting: true }], // Monday
  4: [{ option: 'صيام الخميس 🌒', after: FASTING_ANCHOR, fasting: true }], // Thursday
};

/**
 * "A night yes, a night no": the review poll fires every OTHER night, not
 * nightly — a gentler cadence (one bedtime poll moment every two days). True
 * on a poll night (send), false on an off night. Wired as night_review_poll's
 * skipIf in schedules.ts (skip = !isPollNight); on an off night runSchedule
 * leaves the ring buffer untouched, so the previous poll just stays until the
 * next poll night replaces it.
 *
 * Determinism: keyed off the civil date IN `tz` (never Date.getDay()/the host
 * clock — same discipline as weekdayInTz / pickForDay), turned into a stable
 * day number whose parity flips each calendar day. So a given date is always
 * the same (poll or off), two consecutive nights never match, and it needs no
 * saved state (restart-safe by construction). Even day number = poll night;
 * flip the `=== 0` to shift the phase by one day if the wrong nights land.
 */
function dayNumberInTz(now: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)!.value);
  // Days since the Unix epoch for that civil date (UTC midnight) — a stable
  // integer that increments by exactly 1 per local calendar day.
  return Math.floor(Date.UTC(get('year'), get('month') - 1, get('day')) / 86_400_000);
}

export function isPollNight(now: Date = new Date(), tz: string = config.timezone): boolean {
  return dayNumberInTz(now, tz) % 2 === 0;
}

/** Weekday in `tz` (0=Sun..6=Sat) via Intl, not Date.getDay(), so
 *  "Monday" means Monday in TZ_NAME and not on the host (usually UTC). */
function weekdayInTz(now: Date, tz: string): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? 0;
}

/** Splice each day-extra into the base list at its anchor (see DayOption). */
function applyDayOptions(base: readonly string[], extras: readonly DayOption[]): string[] {
  const options = [...base];
  for (const { option, after } of extras) {
    if (after === undefined) {
      options.push(option);
      continue;
    }
    const at = options.indexOf(after);
    if (at === -1) {
      throw new Error(`night review poll: anchor option not found: ${after}`);
    }
    options.splice(at + 1, 0, option);
  }
  return options;
}

/**
 * Build the poll for a given night. Defaults to now + config.timezone,
 * so the scheduler calls it with no args; the args exist for tests.
 */
export function buildNightReviewPoll(
  now: Date = new Date(),
  tz: string = config.timezone,
): PollSpec {
  const day = weekdayInTz(now, tz);
  // On a day nafl fasting is forbidden (Eid / أيام التشريق) there was no
  // fast to tick, so drop the fasting option — `now` is TODAY, the day the
  // poll reviews. Only fasting-flagged extras go; any future non-fasting
  // day option survives. The fixed worship core always stands.
  const allExtras = OPTIONS_BY_DAY[day] ?? [];
  const extras = noFastReason(now, tz) ? allExtras.filter((e) => !e.fasting) : allExtras;
  // Fixed worship core, with the night's rotating أخلاق + بِرّ checks placed
  // between the morning and night clusters; then splice the day's fasting
  // extra in after its anchor (خشوع الصلاة).
  const base = [
    ...CORE_WAKE,
    rotateForNight(AKHLAQ_CHECKS, now, tz),
    rotateForNight(BIRR_DEEDS, now, tz),
    ...CORE_NIGHT,
  ];
  const options = applyDayOptions(base, extras);

  return {
    question: QUESTION,
    options,
    isAnonymous: true,
    allowsMultipleAnswers: true,
    closeAfterHours: 22,
  };
}
