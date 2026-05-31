import type { Bot, Context } from 'grammy';
import { config } from '../config';
import { logger } from './logger';
import type { PollSpec } from '../types';

/**
 * Send one plain-text message to the channel. No parse_mode on purpose:
 * Arabic du'a/Quran text contains chars Markdown/HTML would 400 on (see
 * CLAUDE.md). Returns the message_id, or null on failure (logged, not
 * thrown, so a transient glitch never crashes the cron tick).
 */
export async function postToChannel(
  bot: Bot<Context>,
  text: string,
  meta: { scheduleName?: string; silent?: boolean } = {},
): Promise<number | null> {
  try {
    // Only pass an options object when posting silently, so the common
    // (audible) path stays a bare (chat_id, text) call with no parse_mode.
    const message = meta.silent
      ? await bot.api.sendMessage(config.channelChatId, text, { disable_notification: true })
      : await bot.api.sendMessage(config.channelChatId, text);
    logger.info('Posted message to channel', {
      scheduleName: meta.scheduleName,
      messageId: message.message_id,
      silent: meta.silent ?? false,
    });
    return message.message_id;
  } catch (err) {
    logger.error('Failed to post message to channel', {
      scheduleName: meta.scheduleName,
      error: String(err),
    });
    return null;
  }
}

/**
 * Delete one previously-posted message (the replace-on-next-fire cleanup
 * in runSchedule). Non-fatal by design: the usual failure is "an admin
 * already deleted it by hand" — log and move on. Needs the bot's
 * `can_delete_messages` admin right, which also lifts Telegram's 48h
 * delete cap (matters for the weekly Friday post). Returns true/false.
 */
export async function deleteChannelMessage(
  bot: Bot<Context>,
  messageId: number,
  meta: { scheduleName?: string } = {},
): Promise<boolean> {
  try {
    await bot.api.deleteMessage(config.channelChatId, messageId);
    logger.info('Deleted previous channel message', {
      scheduleName: meta.scheduleName,
      messageId,
    });
    return true;
  } catch (err) {
    // warn, not error: a missing previous message is routine (an admin
    // tidied the channel by hand).
    logger.warn('Failed to delete previous channel message', {
      scheduleName: meta.scheduleName,
      messageId,
      error: String(err),
    });
    return false;
  }
}

/** Telegram's allowed poll auto-close window, expressed in hours. */
export const MIN_CLOSE_HOURS = 5 / 3600; // 5 seconds
export const MAX_CLOSE_HOURS = 2_628_000 / 3600; // ~30.4 days

/** Unicode bidi isolate (UAX #9): RLI … PDI. */
const RLI = '\u2067'; // RIGHT-TO-LEFT ISOLATE
const PDI = '\u2069'; // POP DIRECTIONAL ISOLATE

/**
 * Wrap an RTL line in a Unicode bidi isolate (RLI…PDI). With no
 * parse_mode the HTML dir="rtl" trick is unavailable; the isolate pins
 * the line right-to-left and walls it off from the vote %/count Telegram
 * appends to each poll option (which was rendering over a leading emoji).
 * Pairs with keeping the emoji at the END of each string (content/poll.ts).
 */
export function rtlIsolate(text: string): string {
  return `${RLI}${text}${PDI}`;
}

/**
 * Send the nightly anonymous self-review poll. Anonymous + multi-answer
 * by default: members tick the deeds they did, everyone sees aggregate
 * percentages, nobody (not even the bot) learns who voted — no DB, no
 * riya. close_date is clamped to Telegram's accepted range so bad config
 * can't 400 the API. Returns the poll message_id, or null on failure.
 */
export async function sendPollToChannel(
  bot: Bot<Context>,
  spec: PollSpec,
  meta: { scheduleName?: string; silent?: boolean } = {},
): Promise<number | null> {
  const isAnonymous = spec.isAnonymous ?? true;
  const allowsMultiple = spec.allowsMultipleAnswers ?? true;

  const requestedHours = spec.closeAfterHours ?? 22;
  const clampedHours = Math.min(Math.max(requestedHours, MIN_CLOSE_HOURS), MAX_CLOSE_HOURS);
  const closeDate = Math.floor(Date.now() / 1000) + Math.round(clampedHours * 3600);

  // Bot API 7.3+ wants InputPollOption objects, not strings. Each option
  // and the question is bidi-isolated (see rtlIsolate).
  const options = spec.options.map((text) => ({ text: rtlIsolate(text) }));

  try {
    const message = await bot.api.sendPoll(
      config.channelChatId,
      rtlIsolate(spec.question),
      options,
      {
        is_anonymous: isAnonymous,
        allows_multiple_answers: allowsMultiple,
        close_date: closeDate,
        disable_notification: meta.silent ?? false,
      },
    );
    logger.info('Posted poll to channel', {
      scheduleName: meta.scheduleName,
      messageId: message.message_id,
      options: spec.options.length,
      isAnonymous,
      closeInHours: clampedHours,
      silent: meta.silent ?? false,
    });
    return message.message_id;
  } catch (err) {
    logger.error('Failed to post poll to channel', {
      scheduleName: meta.scheduleName,
      error: String(err),
    });
    return null;
  }
}
