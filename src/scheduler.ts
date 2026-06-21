import { InlineKeyboard, InputFile, type Bot, type Context } from 'grammy';
import {
  Scheduler,
  pickContent,
  pickForDay,
  post,
  sendPoll,
  deleteMessage,
  getMessageIds,
  setMessageIds,
  logger,
  type CronJob,
} from 'telegram-broadcast-kit';
import type { Message } from 'grammy/types';
import { schedules } from './schedules';
import type { MessageSchedule, ScheduleDef } from './types';
import { cardFor } from './content/cards';
import { getFileId, setFileId, dropFileId, hashFile } from './lib/fileCache';
import { config } from './config';

// The bot-specific schedule layer. The generic cron plumbing (error
// containment, the node-cron registry) now lives in telegram-broadcast-kit;
// this file keeps everything zaaduna-specific on top of it: dispatch on
// `kind`, the ring-buffer cleanup, and the schedule table wiring.

// One Scheduler per bot, holding the live cron tasks so they can all be
// stopped on shutdown. Built lazily on the first startScheduler call.
let scheduler: Scheduler | null = null;

/**
 * Run one schedule and return the new message_id (or null if nothing
 * posted). Dispatches on `kind` (message → post, poll → sendPoll).
 *
 * Ring buffer: each schedule keeps its last `keepLast` posts live
 * (message default 1, poll default 0 = untracked; see types.ts). Order is
 * post-then-trim so the channel is never briefly empty. A failed post
 * leaves state untouched (next fire retries the cleanup); a failed delete
 * still advances state (a stale orphan is benign). Anything not posted
 * here (manual welcome, other admins) is never tracked, never deleted.
 *
 * Exported so /admin_run fires the exact same path. See CLAUDE.md.
 */
export async function runSchedule(bot: Bot<Context>, def: ScheduleDef): Promise<number | null> {
  if (def.skipIf?.(new Date())) {
    // Guard says don't post tonight (e.g. fasting nudge on an Eid/Tashreeq
    // eve). Leave the ring buffer untouched, like a no-content fire.
    logger.info('Schedule skipped by guard', { name: def.name });
    return null;
  }

  const keepLast = effectiveKeepLast(def);

  const newId = await sendForKind(bot, def);
  if (newId === null) {
    return null; // post failed — keep tracked ids so the next fire retries cleanup
  }

  if (keepLast === 0) {
    return newId; // not tracked (untracked poll, or an opt-out one-off)
  }

  const previous = getMessageIds(def.name);
  const next = [...previous, newId];
  const toDelete = next.length > keepLast ? next.splice(0, next.length - keepLast) : [];
  await setMessageIds(def.name, next);

  for (const oldId of toDelete) {
    if (oldId === newId) continue; // never delete what we just posted
    await deleteMessage(bot, config.channelChatId, oldId, { name: def.name });
  }

  return newId;
}

/** Resolve keepLast against the kind-default; clamp bad values to 0 so a
 *  config typo can't break the cron tick. */
function effectiveKeepLast(def: ScheduleDef): number {
  if (typeof def.keepLast === 'number' && Number.isInteger(def.keepLast) && def.keepLast >= 0) {
    return def.keepLast;
  }
  return def.kind === 'message' ? 1 : 0;
}

/** Dispatch on kind. Returns the new message_id or null on failure. */
async function sendForKind(bot: Bot<Context>, def: ScheduleDef): Promise<number | null> {
  if (def.kind === 'poll') {
    // `poll` may be a factory rebuilt per fire (day-of-week variants).
    const spec = typeof def.poll === 'function' ? def.poll() : def.poll;
    return sendPoll(bot, config.channelChatId, spec, { name: def.name, silent: def.silent });
  }
  // 'daily' walks an evergreen pool one item a day (same date → same
  // item, no consecutive repeats), computed in config.timezone so "today"
  // means today in the bot's TZ, not the host clock. Everything else picks
  // at random. A fixed string is returned as-is by both pickers.
  const text =
    def.selection === 'daily'
      ? pickForDay(def.content, new Date(), config.timezone)
      : pickContent(def.content);
  if (!text) {
    logger.warn('Schedule has no content to post, skipping', { name: def.name });
    return null;
  }
  // Optional day-alternating card (variant 1/2), sent as a silent photo just
  // above the text; replaced on the next fire. Non-fatal — see sendCard.
  if (def.images) {
    await sendCard(bot, def);
  }
  const id = await post(bot, config.channelChatId, text, {
    name: def.name,
    silent: def.silent,
    // HTML for the long azkar (bold title); undefined = plain text for
    // everything else. Content is pre-escaped by azkarHtml().
    parseMode: def.parseMode,
  });
  if (id !== null && def.buttons?.length) {
    await attachButtons(bot, id, def.buttons, def.name);
  }
  return id;
}

/**
 * Send the day's azkar card (variant 1 on even civil days, variant 2 on odd —
 * see content/cards.ts) as a SILENT photo, and replace the previous card. The
 * azkar text far exceeds Telegram's 1024-char photo caption, so the card is
 * its own message just above the text. Tracked under a `${name}::card` state
 * key, separate from the text ring buffer, so the text's replace-on-next-fire
 * is untouched. Order is post-then-trim (send new, then delete old) so the
 * channel is never card-less mid-swap. Non-fatal: a failure is logged and the
 * text still posts (the card-less message stands).
 *
 * The photo itself goes through postCard, which resends by cached file_id
 * (no upload) when it can — see lib/fileCache.ts.
 */
async function sendCard(bot: Bot<Context>, def: MessageSchedule): Promise<void> {
  if (!def.images) return;
  const path = cardFor(def.images);
  const key = `${def.name}::card`;
  const newId = await postCard(bot, path, def.name);
  if (newId === null) return; // send failed — non-fatal, the text still posts.
  const previous = getMessageIds(key);
  await setMessageIds(key, [newId]);
  for (const oldId of previous) {
    await deleteMessage(bot, config.channelChatId, oldId, { name: key });
  }
}

/** The file_id of the largest size of a sent photo, if any. Telegram returns
 *  several sizes; the last is the largest, and a file_id from any size resends
 *  the original photo. */
function largestPhotoFileId(msg: Message): string | undefined {
  const sizes = msg.photo;
  return sizes && sizes.length > 0 ? sizes[sizes.length - 1]!.file_id : undefined;
}

/**
 * Post one card photo (SILENT) and return its message_id, or null on failure.
 *
 * Reuses Telegram's own copy when possible: the card bytes are hashed, and if
 * that hash has a cached file_id we resend by the string (no upload — Telegram
 * serves its cached file and clients render it instantly, which is the whole
 * point — see lib/fileCache.ts). On a cache miss we upload from disk via
 * InputFile and cache the resulting file_id for next time. A cached file_id
 * can rarely go stale (server purge); if Telegram rejects it we drop it from
 * the cache and re-upload once. If the file can't be hashed we just upload
 * without caching. The card image and its text are byte-stable across days, so
 * after the first upload every later fire is a cache hit.
 */
async function postCard(bot: Bot<Context>, path: string, name: string): Promise<number | null> {
  const hash = await hashFile(path);
  const cachedId = hash ? getFileId(hash) : undefined;

  // Fast path: resend Telegram's cached copy by file_id, no upload.
  if (cachedId) {
    try {
      const msg = await bot.api.sendPhoto(config.channelChatId, cachedId, {
        disable_notification: true,
      });
      logger.info('Posted azkar card from cached file_id', {
        name,
        messageId: msg.message_id,
      });
      return msg.message_id;
    } catch (err) {
      // The cached id is probably stale (rare server purge). Forget it and
      // fall through to a fresh upload below.
      logger.warn('Cached file_id rejected, re-uploading card', { name, error: String(err) });
      if (hash) await dropFileId(hash);
    }
  }

  // Slow path: upload from disk, then cache the file_id Telegram hands back.
  try {
    const msg = await bot.api.sendPhoto(config.channelChatId, new InputFile(path), {
      disable_notification: true,
    });
    const fileId = largestPhotoFileId(msg);
    if (hash && fileId) await setFileId(hash, fileId);
    logger.info('Posted azkar card', {
      name,
      path,
      messageId: msg.message_id,
      cached: Boolean(hash && fileId),
    });
    return msg.message_id;
  } catch (err) {
    logger.warn('Failed to send azkar card; posting text only', {
      name,
      path,
      error: String(err),
    });
    return null;
  }
}

/**
 * Attach inline URL buttons to a just-posted channel message. Done as a
 * follow-up edit (not part of the send) so the kit's post() stays the single
 * place that sends + logs + returns the id. Channels only allow inline
 * keyboards; URL buttons cost nothing against the 4096-char limit. Non-fatal:
 * a failure is logged and the (button-less) message still stands, so a hiccup
 * here never costs the post or the ring-buffer cleanup.
 */
async function attachButtons(
  bot: Bot<Context>,
  messageId: number,
  rows: NonNullable<MessageSchedule['buttons']>,
  name: string,
): Promise<void> {
  try {
    const keyboard = new InlineKeyboard();
    rows.forEach((row, i) => {
      for (const b of row) keyboard.url(b.text, b.url);
      if (i < rows.length - 1) keyboard.row();
    });
    await bot.api.editMessageReplyMarkup(config.channelChatId, messageId, {
      reply_markup: keyboard,
    });
    logger.info('Attached buttons to channel message', {
      name,
      messageId,
      buttons: rows.flat().length,
    });
  } catch (err) {
    logger.warn('Failed to attach buttons to channel message', {
      name,
      messageId,
      error: String(err),
    });
  }
}

/**
 * Register every schedule with the kit's Scheduler. The kit validates each
 * cron (an invalid one is logged and skipped, so a single typo never takes
 * the whole bot down) and wraps every fire in runJob for error containment.
 * Returns the count registered.
 */
export function startScheduler(bot: Bot<Context>): number {
  scheduler = new Scheduler(config.timezone);
  const jobs: CronJob[] = schedules.map((def) => ({
    name: def.name,
    cron: def.cron,
    // Each fire goes through the SAME runSchedule the /admin_run path uses;
    // runJob (inside the Scheduler) contains a thrown/rejected tick. The
    // Scheduler ignores the returned id, so the wrapper resolves to void.
    run: async () => {
      await runSchedule(bot, def);
    },
  }));
  return scheduler.start(jobs);
}

export function stopScheduler(): void {
  scheduler?.stop();
  scheduler = null;
}
