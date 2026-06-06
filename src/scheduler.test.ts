import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Bot, Context } from 'grammy';
import { runSchedule } from './scheduler';
import { findSchedule } from './schedules';
import type { ScheduleDef } from './types';
import {
  _resetForTests as resetState,
  getLastMessageId,
  setLastMessageId,
  getMessageIds,
} from 'telegram-broadcast-kit';

/**
 * runSchedule must dispatch on `kind`: messages go through sendMessage,
 * polls go through sendPoll, and empty content posts nothing. No network.
 *
 * It must also implement replace-on-next-fire: a successful message
 * post updates the state pointer to the new message_id and deletes the
 * previously-tracked one. Polls are never tracked or deleted. A failed
 * post leaves state untouched so the next fire can still clean up.
 */

function fakeBot() {
  const sendMessage = vi.fn().mockResolvedValue({ message_id: 11 });
  const sendPoll = vi.fn().mockResolvedValue({ message_id: 22 });
  const deleteMessage = vi.fn().mockResolvedValue(true);
  const editMessageReplyMarkup = vi.fn().mockResolvedValue(true);
  const bot = {
    api: { sendMessage, sendPoll, deleteMessage, editMessageReplyMarkup },
  } as unknown as Bot<Context>;
  return { bot, sendMessage, sendPoll, deleteMessage, editMessageReplyMarkup };
}

// Wipe the in-memory pointer store between cases so one test's posts
// can never trigger the next test's "delete previous" path.
beforeEach(() => {
  resetState();
});

describe('runSchedule dispatch', () => {
  it('a message schedule calls sendMessage, not sendPoll', async () => {
    const { bot, sendMessage, sendPoll } = fakeBot();
    const def = findSchedule('morning_azkar')!;
    expect(def.kind).toBe('message');
    const id = await runSchedule(bot, def);
    expect(id).toBe(11);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendPoll).not.toHaveBeenCalled();
  });

  it('the poll schedule calls sendPoll, not sendMessage', async () => {
    const { bot, sendMessage, sendPoll } = fakeBot();
    const def = findSchedule('night_review_poll')!;
    expect(def.kind).toBe('poll');
    const id = await runSchedule(bot, def);
    expect(id).toBe(22);
    expect(sendPoll).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('a message schedule with empty array content posts nothing', async () => {
    const { bot, sendMessage, sendPoll } = fakeBot();
    const empty: ScheduleDef = {
      name: 'empty',
      kind: 'message',
      cron: '0 3 * * *',
      content: [],
    };
    const id = await runSchedule(bot, empty);
    expect(id).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(sendPoll).not.toHaveBeenCalled();
  });

  it('propagates a null result when the send fails', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('boom'));
    const sendPoll = vi.fn();
    const deleteMessage = vi.fn();
    const bot = {
      api: { sendMessage, sendPoll, deleteMessage },
    } as unknown as Bot<Context>;
    const def = findSchedule('evening_azkar')!;
    await expect(runSchedule(bot, def)).resolves.toBeNull();
  });
});

describe('runSchedule daily selection (akhlaq library)', () => {
  it('posts a message and, with keepLast 0, never tracks or deletes', async () => {
    const { bot, sendMessage, sendPoll, deleteMessage } = fakeBot();
    const def = findSchedule('akhlaq_reminder')!;
    expect(def.kind).toBe('message');

    await runSchedule(bot, def);
    await runSchedule(bot, def);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendPoll).not.toHaveBeenCalled();
    // keepLast 0 → the growing library is never trimmed and never tracked.
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(getLastMessageId('akhlaq_reminder')).toBeUndefined();
  });

  it('same day, two fires: both post the same text', async () => {
    // selection 'daily' picks by day-of-the-year, so running it twice on the
    // same day sends the same item (not a fresh random one each time).
    const { bot, sendMessage } = fakeBot();
    const def = findSchedule('akhlaq_reminder')!;

    await runSchedule(bot, def);
    await runSchedule(bot, def);

    // post() forwards (chatId, text, opts); text is the second arg.
    const first = sendMessage.mock.calls[0][1];
    const second = sendMessage.mock.calls[1][1];
    expect(typeof first).toBe('string');
    expect(first.trim().length).toBeGreaterThan(0);
    expect(second).toBe(first);
  });
});

describe('runSchedule replace-on-next-fire (messages only)', () => {
  it('first fire posts and tracks the message_id but does NOT delete anything', async () => {
    const { bot, sendMessage, deleteMessage } = fakeBot();
    const def = findSchedule('morning_azkar')!;
    const id = await runSchedule(bot, def);
    expect(id).toBe(11);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(getLastMessageId('morning_azkar')).toBe(11);
  });

  it('second fire posts the new copy and deletes the previously-tracked one', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ message_id: 101 })
      .mockResolvedValueOnce({ message_id: 102 });
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const bot = {
      api: { sendMessage, sendPoll: vi.fn(), deleteMessage },
    } as unknown as Bot<Context>;
    const def = findSchedule('morning_azkar')!;

    await runSchedule(bot, def);
    await runSchedule(bot, def);

    // Two posts, one delete (of the first).
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(deleteMessage).toHaveBeenCalledTimes(1);
    expect(deleteMessage.mock.calls[0][1]).toBe(101);
    expect(getLastMessageId('morning_azkar')).toBe(102);

    // Post must happen before delete, never the other way around: in the
    // mock-call timeline the second sendMessage call records earlier
    // than the deleteMessage call.
    const order =
      sendMessage.mock.invocationCallOrder[1] < deleteMessage.mock.invocationCallOrder[0];
    expect(order).toBe(true);
  });

  it('a failed post leaves the previous pointer intact for next time', async () => {
    // Pre-seed a previous id so we can prove it survives a failed fire.
    await setLastMessageId('evening_azkar', 555);

    const sendMessage = vi.fn().mockRejectedValue(new Error('429'));
    const deleteMessage = vi.fn();
    const bot = {
      api: { sendMessage, sendPoll: vi.fn(), deleteMessage },
    } as unknown as Bot<Context>;
    const def = findSchedule('evening_azkar')!;

    await expect(runSchedule(bot, def)).resolves.toBeNull();

    // Pointer not advanced and delete not attempted — tomorrow we can
    // still try to clean up message 555.
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(getLastMessageId('evening_azkar')).toBe(555);
  });

  it('a failed delete still advances the pointer (best-effort cleanup, log + continue)', async () => {
    await setLastMessageId('morning_azkar', 700);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 701 });
    const deleteMessage = vi.fn().mockRejectedValue(new Error('400 message to delete not found'));
    const bot = {
      api: { sendMessage, sendPoll: vi.fn(), deleteMessage },
    } as unknown as Bot<Context>;
    const def = findSchedule('morning_azkar')!;

    const id = await runSchedule(bot, def);

    expect(id).toBe(701);
    expect(deleteMessage).toHaveBeenCalledWith('@test_channel', 700);
    // Pointer moved to the new id even though delete failed — a stale
    // orphan is benign; double-attempting the same delete would not
    // help and would noise the logs.
    expect(getLastMessageId('morning_azkar')).toBe(701);
  });

  it('a poll WITHOUT keepLast is never tracked (historic default)', async () => {
    const { bot, sendPoll, deleteMessage } = fakeBot();
    // Synthetic poll def with no keepLast, to lock in the default-poll
    // behavior independent of what schedules.ts happens to set today.
    const untrackedPoll: ScheduleDef = {
      name: 'untracked_poll',
      kind: 'poll',
      cron: '0 3 * * *',
      poll: { question: 'q', options: ['a', 'b'] },
    };
    await runSchedule(bot, untrackedPoll);
    await runSchedule(bot, untrackedPoll);
    await runSchedule(bot, untrackedPoll);

    expect(sendPoll).toHaveBeenCalledTimes(3);
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(getLastMessageId('untracked_poll')).toBeUndefined();
  });

  it('a skipIf guard posts nothing and leaves the ring buffer untouched', async () => {
    const { bot, sendMessage, deleteMessage } = fakeBot();
    await setLastMessageId('guarded', 900); // pre-seed a previous post
    const guarded: ScheduleDef = {
      name: 'guarded',
      kind: 'message',
      cron: '0 3 * * *',
      content: 'hello',
      skipIf: () => true,
    };

    await expect(runSchedule(bot, guarded)).resolves.toBeNull();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(getLastMessageId('guarded')).toBe(900); // previous copy survives
  });

  it('a skipIf returning false posts as usual', async () => {
    const { bot, sendMessage } = fakeBot();
    const open: ScheduleDef = {
      name: 'open',
      kind: 'message',
      cron: '0 3 * * *',
      content: 'hello',
      skipIf: () => false,
    };
    await expect(runSchedule(bot, open)).resolves.toBe(11);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('different schedules track their pointers independently', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ message_id: 1 }) // morning
      .mockResolvedValueOnce({ message_id: 2 }) // evening
      .mockResolvedValueOnce({ message_id: 3 }) // morning again
      .mockResolvedValueOnce({ message_id: 4 }); // evening again
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const bot = {
      api: { sendMessage, sendPoll: vi.fn(), deleteMessage },
    } as unknown as Bot<Context>;
    const morning = findSchedule('morning_azkar')!;
    const evening = findSchedule('evening_azkar')!;

    await runSchedule(bot, morning);
    await runSchedule(bot, evening);
    await runSchedule(bot, morning);
    await runSchedule(bot, evening);

    // First fire of each does no delete; second fires delete the first ids.
    expect(deleteMessage).toHaveBeenCalledTimes(2);
    const deletedIds = deleteMessage.mock.calls.map((c) => c[1]).sort();
    expect(deletedIds).toEqual([1, 2]);
    expect(getLastMessageId('morning_azkar')).toBe(3);
    expect(getLastMessageId('evening_azkar')).toBe(4);
  });
});

describe('runSchedule inline buttons', () => {
  it('attaches buttons via editMessageReplyMarkup for a schedule that has them', async () => {
    const { bot, editMessageReplyMarkup } = fakeBot();
    const def = findSchedule('pre_sleep')!;
    expect(def.kind).toBe('message');

    const id = await runSchedule(bot, def);

    expect(id).toBe(11);
    expect(editMessageReplyMarkup).toHaveBeenCalledTimes(1);
    // Called with (chatId, the just-posted messageId, { reply_markup }).
    const [, messageId, other] = editMessageReplyMarkup.mock.calls[0];
    expect(messageId).toBe(11);
    // pre_sleep has two rows (المُلك, then السجدة); the keyboard mirrors that.
    expect(other.reply_markup.inline_keyboard).toHaveLength(2);
    expect(other.reply_markup.inline_keyboard[0][0].url).toContain('quran.com/67');
  });

  it('does not touch editMessageReplyMarkup for a schedule without buttons', async () => {
    const { bot, editMessageReplyMarkup } = fakeBot();
    const def = findSchedule('morning_azkar')!;
    await runSchedule(bot, def);
    expect(editMessageReplyMarkup).not.toHaveBeenCalled();
  });

  it('a failed button attach is non-fatal: id still returned, pointer advanced', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 77 });
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const editMessageReplyMarkup = vi.fn().mockRejectedValue(new Error('boom'));
    const bot = {
      api: { sendMessage, sendPoll: vi.fn(), deleteMessage, editMessageReplyMarkup },
    } as unknown as Bot<Context>;
    const def = findSchedule('friday_sunnah')!;

    const id = await runSchedule(bot, def);

    // The post and the ring-buffer pointer succeed even though buttons failed.
    expect(id).toBe(77);
    expect(getLastMessageId('friday_sunnah')).toBe(77);
  });
});

describe('runSchedule ring buffer (keepLast > 1)', () => {
  // A standalone poll def with keepLast=2 so this suite is independent
  // of whatever the production schedules.ts happens to set.
  const ringPoll: ScheduleDef = {
    name: 'ring_poll',
    kind: 'poll',
    cron: '0 22 * * *',
    poll: { question: 'q', options: ['a', 'b'] },
    keepLast: 2,
  };

  it('first two fires fill the buffer; nothing is deleted yet', async () => {
    const sendPoll = vi
      .fn()
      .mockResolvedValueOnce({ message_id: 1001 })
      .mockResolvedValueOnce({ message_id: 1002 });
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const bot = {
      api: { sendMessage: vi.fn(), sendPoll, deleteMessage },
    } as unknown as Bot<Context>;

    await runSchedule(bot, ringPoll);
    await runSchedule(bot, ringPoll);

    expect(sendPoll).toHaveBeenCalledTimes(2);
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(getMessageIds('ring_poll')).toEqual([1001, 1002]);
  });

  it('third fire posts, then deletes the oldest of the previous two', async () => {
    const sendPoll = vi
      .fn()
      .mockResolvedValueOnce({ message_id: 1001 })
      .mockResolvedValueOnce({ message_id: 1002 })
      .mockResolvedValueOnce({ message_id: 1003 });
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const bot = {
      api: { sendMessage: vi.fn(), sendPoll, deleteMessage },
    } as unknown as Bot<Context>;

    await runSchedule(bot, ringPoll);
    await runSchedule(bot, ringPoll);
    await runSchedule(bot, ringPoll);

    expect(sendPoll).toHaveBeenCalledTimes(3);
    expect(deleteMessage).toHaveBeenCalledTimes(1);
    // The oldest (1001) is what gets cleaned up; 1002 + 1003 remain live.
    expect(deleteMessage.mock.calls[0][1]).toBe(1001);
    expect(getMessageIds('ring_poll')).toEqual([1002, 1003]);

    // Post must happen before delete on this fire too.
    const postOrder = sendPoll.mock.invocationCallOrder[2];
    const deleteOrder = deleteMessage.mock.invocationCallOrder[0];
    expect(postOrder < deleteOrder).toBe(true);
  });

  it('the real night_review_poll schedule is wired for replace-on-next-fire (keepLast=1)', async () => {
    // Polls default to keepLast=0 (untracked), so this asserts the poll
    // actively opts in to cleanup with the same single-live-copy rule
    // messages use. If someone bumps it back to a ring buffer the test
    // forces them to update this expectation deliberately.
    const sendPoll = vi
      .fn()
      .mockResolvedValueOnce({ message_id: 9001 })
      .mockResolvedValueOnce({ message_id: 9002 });
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const bot = {
      api: { sendMessage: vi.fn(), sendPoll, deleteMessage },
    } as unknown as Bot<Context>;
    const def = findSchedule('night_review_poll')!;
    expect(def.keepLast).toBe(1);

    await runSchedule(bot, def);
    await runSchedule(bot, def);

    expect(deleteMessage).toHaveBeenCalledTimes(1);
    expect(deleteMessage.mock.calls[0][1]).toBe(9001);
    expect(getMessageIds('night_review_poll')).toEqual([9002]);
  });

  it('a failed post on a ring-buffer fire leaves tracked ids untouched', async () => {
    const sendPoll = vi
      .fn()
      .mockResolvedValueOnce({ message_id: 1001 })
      .mockResolvedValueOnce({ message_id: 1002 })
      .mockRejectedValueOnce(new Error('429'));
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const bot = {
      api: { sendMessage: vi.fn(), sendPoll, deleteMessage },
    } as unknown as Bot<Context>;

    await runSchedule(bot, ringPoll);
    await runSchedule(bot, ringPoll);
    await expect(runSchedule(bot, ringPoll)).resolves.toBeNull();

    // No delete attempted on the failed fire — tomorrow we will still
    // try to clean up 1001.
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(getMessageIds('ring_poll')).toEqual([1001, 1002]);
  });
});
