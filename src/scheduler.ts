import cron, { type ScheduledTask } from 'node-cron';
import type { Bot, Context } from 'grammy';
import { schedules } from './schedules';
import type { ScheduleDef } from './types';
import { pickContent } from './lib/pick';
import { postToChannel, sendPollToChannel, deleteChannelMessage } from './lib/post';
import { logger } from './lib/logger';
import { config } from './config';
import { getMessageIds, setMessageIds } from './lib/state';

const tasks: ScheduledTask[] = [];

/**
 * Run one schedule and return the new message_id (or null if nothing
 * posted). Dispatches on `kind` (message → sendMessage, poll → sendPoll).
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
    await deleteChannelMessage(bot, oldId, { scheduleName: def.name });
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
    return sendPollToChannel(bot, spec, { scheduleName: def.name, silent: def.silent });
  }
  const text = pickContent(def.content);
  if (!text) {
    logger.warn('Schedule has no content to post, skipping', { name: def.name });
    return null;
  }
  return postToChannel(bot, text, { scheduleName: def.name, silent: def.silent });
}

/** Wrap a schedule run with logging + error containment (node-cron does
 *  not reliably catch rejected promises across versions). */
function trackedJob(bot: Bot<Context>, def: ScheduleDef): () => Promise<void> {
  return async () => {
    logger.info('Schedule firing', { name: def.name, kind: def.kind });
    try {
      await runSchedule(bot, def);
    } catch (err) {
      logger.error('Schedule failed', { name: def.name, error: String(err) });
    }
  };
}

/**
 * Register every schedule with node-cron. An invalid cron is logged and
 * skipped; the rest still run. Returns the count registered.
 */
export function startScheduler(bot: Bot<Context>): number {
  for (const def of schedules) {
    if (!cron.validate(def.cron)) {
      logger.error('Invalid cron expression, skipping schedule', {
        name: def.name,
        cron: def.cron,
      });
      continue;
    }
    const task = cron.schedule(def.cron, trackedJob(bot, def), {
      timezone: config.timezone,
    });
    tasks.push(task);
  }
  logger.info('Scheduler started', { registered: tasks.length, timezone: config.timezone });
  return tasks.length;
}

export function stopScheduler(): void {
  for (const task of tasks) task.stop();
  tasks.length = 0;
  logger.info('Scheduler stopped');
}
