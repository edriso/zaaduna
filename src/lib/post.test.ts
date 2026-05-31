import { describe, it, expect, vi } from 'vitest';
import type { Bot, Context } from 'grammy';
import {
  postToChannel,
  sendPollToChannel,
  deleteChannelMessage,
  rtlIsolate,
  MIN_CLOSE_HOURS,
  MAX_CLOSE_HOURS,
} from './post';
import type { PollSpec } from '../types';

/**
 * No network. We pass a fake bot whose `api` is spied, and assert what
 * we send to Telegram and how failures are contained.
 */

function fakeBot(overrides: {
  sendMessage?: ReturnType<typeof vi.fn>;
  sendPoll?: ReturnType<typeof vi.fn>;
  deleteMessage?: ReturnType<typeof vi.fn>;
}) {
  return {
    api: {
      sendMessage: overrides.sendMessage ?? vi.fn().mockResolvedValue({ message_id: 1 }),
      sendPoll: overrides.sendPoll ?? vi.fn().mockResolvedValue({ message_id: 2 }),
      deleteMessage: overrides.deleteMessage ?? vi.fn().mockResolvedValue(true),
    },
  } as unknown as Bot<Context>;
}

describe('rtlIsolate', () => {
  const RLI = '\u2067';
  const PDI = '\u2069';

  it('wraps the string in RLI … PDI and nothing else', () => {
    expect(rtlIsolate('أذكار الصباح 🌅')).toBe(`${RLI}أذكار الصباح 🌅${PDI}`);
  });

  it('adds exactly two code points (well under Telegram limits)', () => {
    const wrapped = rtlIsolate('x');
    expect([...wrapped]).toHaveLength(3);
    expect(wrapped.startsWith(RLI)).toBe(true);
    expect(wrapped.endsWith(PDI)).toBe(true);
  });

  it('preserves the original text verbatim between the marks', () => {
    const original = 'ورد القرآن (ولو صفحة) 🔖';
    expect(rtlIsolate(original).slice(1, -1)).toBe(original);
  });
});

describe('postToChannel', () => {
  it('returns the message_id on success', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 42 });
    const bot = fakeBot({ sendMessage });
    const id = await postToChannel(bot, 'سلام', { scheduleName: 'x' });
    expect(id).toBe(42);
  });

  it('sends plain text with NO parse_mode (Arabic safety)', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 1 });
    const bot = fakeBot({ sendMessage });
    await postToChannel(bot, 'نص فيه * و _ و ( ) ولن يكسر');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const args = sendMessage.mock.calls[0];
    // (chat_id, text) only — no third "other" argument.
    expect(args.length).toBe(2);
    expect(args[1]).toContain('لن يكسر');
  });

  it('returns null (does not throw) when Telegram fails', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('403 forbidden'));
    const bot = fakeBot({ sendMessage });
    await expect(postToChannel(bot, 'hi', { scheduleName: 'x' })).resolves.toBeNull();
  });

  it('posts silently when asked: disable_notification true, still no parse_mode', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 7 });
    const bot = fakeBot({ sendMessage });
    await postToChannel(bot, 'ذكر صامت', { scheduleName: 'friday_sunnah', silent: true });
    const args = sendMessage.mock.calls[0];
    expect(args.length).toBe(3); // (chat_id, text, other)
    expect(args[2]).toEqual({ disable_notification: true });
    expect(args[2].parse_mode).toBeUndefined();
  });

  it('does not pass a notification flag on the audible (default) path', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 8 });
    const bot = fakeBot({ sendMessage });
    await postToChannel(bot, 'ذكر مسموع', { scheduleName: 'morning_azkar' });
    // Bare (chat_id, text): no options object at all, so the post rings.
    expect(sendMessage.mock.calls[0].length).toBe(2);
  });
});

describe('sendPollToChannel', () => {
  const base: PollSpec = {
    question: 'بماذا أتممت يومك؟',
    options: ['أذكار الصباح', 'أذكار المساء', 'سورة الملك'],
  };

  it('returns the poll message_id on success', async () => {
    const sendPoll = vi.fn().mockResolvedValue({ message_id: 99 });
    const bot = fakeBot({ sendPoll });
    const id = await sendPollToChannel(bot, base, { scheduleName: 'p' });
    expect(id).toBe(99);
  });

  it('defaults to anonymous + multi-answer and bidi-isolated InputPollOption objects', async () => {
    const sendPoll = vi.fn().mockResolvedValue({ message_id: 1 });
    const bot = fakeBot({ sendPoll });
    await sendPollToChannel(bot, base);
    const [, question, options, other] = sendPoll.mock.calls[0];
    expect(question).toBe(rtlIsolate(base.question));
    expect(options).toEqual([
      { text: rtlIsolate('أذكار الصباح') },
      { text: rtlIsolate('أذكار المساء') },
      { text: rtlIsolate('سورة الملك') },
    ]);
    expect(other.is_anonymous).toBe(true);
    expect(other.allows_multiple_answers).toBe(true);
  });

  it('sends the poll with NO parse_mode (the reason rtlIsolate exists)', async () => {
    const sendPoll = vi.fn().mockResolvedValue({ message_id: 1 });
    const bot = fakeBot({ sendPoll });
    await sendPollToChannel(bot, base);
    const other = sendPoll.mock.calls[0][3];
    // The bidi fix must work on PLAIN text: parse_mode would 400 on the
    // Arabic du'a punctuation, which is exactly why we cannot use the
    // HTML dir="rtl" approach and use the Unicode isolate instead.
    expect(other.parse_mode).toBeUndefined();
  });

  it('honours explicit isAnonymous:false / allowsMultipleAnswers:false', async () => {
    const sendPoll = vi.fn().mockResolvedValue({ message_id: 1 });
    const bot = fakeBot({ sendPoll });
    await sendPollToChannel(bot, {
      ...base,
      isAnonymous: false,
      allowsMultipleAnswers: false,
    });
    const other = sendPoll.mock.calls[0][3];
    expect(other.is_anonymous).toBe(false);
    expect(other.allows_multiple_answers).toBe(false);
  });

  it('rings by default (disable_notification false) and is silenceable', async () => {
    const audible = vi.fn().mockResolvedValue({ message_id: 1 });
    await sendPollToChannel(fakeBot({ sendPoll: audible }), base);
    expect(audible.mock.calls[0][3].disable_notification).toBe(false);

    const silent = vi.fn().mockResolvedValue({ message_id: 1 });
    await sendPollToChannel(fakeBot({ sendPoll: silent }), base, { silent: true });
    expect(silent.mock.calls[0][3].disable_notification).toBe(true);
  });

  it('sets a future close_date ~22h ahead by default', async () => {
    const sendPoll = vi.fn().mockResolvedValue({ message_id: 1 });
    const bot = fakeBot({ sendPoll });
    const before = Math.floor(Date.now() / 1000);
    await sendPollToChannel(bot, base);
    const closeDate = sendPoll.mock.calls[0][3].close_date as number;
    expect(closeDate).toBeGreaterThan(before);
    expect(closeDate).toBeCloseTo(before + 22 * 3600, -2);
  });

  it('clamps an absurdly large closeAfterHours into Telegram range', async () => {
    const sendPoll = vi.fn().mockResolvedValue({ message_id: 1 });
    const bot = fakeBot({ sendPoll });
    const before = Math.floor(Date.now() / 1000);
    await sendPollToChannel(bot, { ...base, closeAfterHours: 99_999 });
    const closeDate = sendPoll.mock.calls[0][3].close_date as number;
    expect(closeDate).toBeLessThanOrEqual(before + Math.round(MAX_CLOSE_HOURS * 3600) + 2);
  });

  it('clamps a zero/negative closeAfterHours up to the minimum', async () => {
    const sendPoll = vi.fn().mockResolvedValue({ message_id: 1 });
    const bot = fakeBot({ sendPoll });
    const before = Math.floor(Date.now() / 1000);
    await sendPollToChannel(bot, { ...base, closeAfterHours: -5 });
    const closeDate = sendPoll.mock.calls[0][3].close_date as number;
    expect(closeDate).toBeGreaterThanOrEqual(before + Math.floor(MIN_CLOSE_HOURS * 3600));
  });

  it('returns null (does not throw) when Telegram fails', async () => {
    const sendPoll = vi.fn().mockRejectedValue(new Error('429 too many requests'));
    const bot = fakeBot({ sendPoll });
    await expect(sendPollToChannel(bot, base)).resolves.toBeNull();
  });
});

describe('deleteChannelMessage', () => {
  it('calls bot.api.deleteMessage with the configured channel id and the message id', async () => {
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const bot = fakeBot({ deleteMessage });
    const ok = await deleteChannelMessage(bot, 555, { scheduleName: 'morning_azkar' });
    expect(ok).toBe(true);
    expect(deleteMessage).toHaveBeenCalledTimes(1);
    const [chatId, messageId] = deleteMessage.mock.calls[0];
    // vitest.config.ts injects CHANNEL_CHAT_ID="@test_channel".
    expect(chatId).toBe('@test_channel');
    expect(messageId).toBe(555);
  });

  it('returns false (does not throw) when Telegram rejects the delete', async () => {
    // The most common cause: admin already deleted that message by hand.
    const deleteMessage = vi
      .fn()
      .mockRejectedValue(new Error('400 Bad Request: message to delete not found'));
    const bot = fakeBot({ deleteMessage });
    await expect(deleteChannelMessage(bot, 999, { scheduleName: 'evening_azkar' })).resolves.toBe(
      false,
    );
  });

  it('returns false on a transient network error without bubbling up', async () => {
    const deleteMessage = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    const bot = fakeBot({ deleteMessage });
    await expect(deleteChannelMessage(bot, 1)).resolves.toBe(false);
  });
});
