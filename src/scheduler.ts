import type { Bot, Context } from 'grammy';
import {
  Scheduler,
  pickContent,
  post,
  sendPoll,
  deleteMessage,
  getMessageIds,
  setMessageIds,
  logger,
  type CronJob,
} from 'telegram-broadcast-kit';
import { schedules } from './schedules';
import type { ScheduleDef } from './types';
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
  const text = pickContent(def.content);
  if (!text) {
    logger.warn('Schedule has no content to post, skipping', { name: def.name });
    return null;
  }
  return post(bot, config.channelChatId, text, { name: def.name, silent: def.silent });
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
