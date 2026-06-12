import { describe, it, expect } from 'vitest';
import cron from 'node-cron';
import { schedules, findSchedule } from './schedules';
import { MIN_CLOSE_HOURS, MAX_CLOSE_HOURS, rtlIsolate } from 'telegram-broadcast-kit';
import { buildNightReviewPoll, isPollNight } from './content/poll';
import { renderedText } from './content/format';
import { hijriDate } from './lib/hijri';
import type { PollSpec } from './types';

/**
 * The schedules array is the central config. These tests guard against
 * easy mistakes (bad cron, duplicate names, empty content) and against
 * Telegram's poll limits, so config errors are caught before deploy —
 * no DB or network needed.
 */

// Telegram limits we rely on.
const MAX_MESSAGE_CHARS = 4096;
const MAX_QUESTION_CHARS = 255; // Telegram allows 300; we keep a margin.
const MAX_OPTION_CHARS = 100;

describe('schedules (general)', () => {
  it('has at least one entry', () => {
    expect(schedules.length).toBeGreaterThan(0);
  });

  it('every entry has a valid cron expression', () => {
    for (const s of schedules) {
      expect(cron.validate(s.cron), `${s.name} cron should be valid`).toBe(true);
    }
  });

  it('every entry has a non-empty name and a known kind', () => {
    for (const s of schedules) {
      expect(s.name.trim().length).toBeGreaterThan(0);
      expect(['message', 'poll']).toContain(s.kind);
    }
  });

  it('names are unique', () => {
    const names = schedules.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all fixed-hour schedules are at 02:00 or later (Cairo DST gap)', () => {
    for (const s of schedules) {
      const hour = s.cron.split(/\s+/)[1];
      // Only assert for fixed numeric hours (skip "*", ranges, lists).
      if (/^\d+$/.test(hour)) {
        expect(Number(hour), `${s.name} hour must be >= 2`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('message schedules', () => {
  const messageSchedules = schedules.filter((s) => s.kind === 'message');

  it('there is at least one message schedule', () => {
    expect(messageSchedules.length).toBeGreaterThan(0);
  });

  it('content resolves to something postable within Telegram limits', () => {
    for (const s of messageSchedules) {
      if (s.kind !== 'message') continue; // narrow for TS
      const items = typeof s.content === 'string' ? [s.content] : s.content;
      expect(items.length, `${s.name} has no content`).toBeGreaterThan(0);
      for (const text of items) {
        expect(text.trim().length, `${s.name} has empty content`).toBeGreaterThan(0);
        // Telegram's 4096 limit is on the RENDERED text, not the raw markup:
        // HTML tags (the azkar bold title) do not count. Measure what
        // Telegram measures. renderedText is a no-op on plain content.
        expect(renderedText(text).length, `${s.name} message too long`).toBeLessThanOrEqual(
          MAX_MESSAGE_CHARS,
        );
      }
    }
  });
});

describe('message buttons (inline URL keyboard)', () => {
  const withButtons = schedules.filter(
    (s): s is typeof s & { kind: 'message' } => s.kind === 'message' && !!s.buttons?.length,
  );

  it('at least the pre_sleep and friday_sunnah messages carry buttons', () => {
    const names = withButtons.map((s) => s.name);
    expect(names).toContain('pre_sleep');
    expect(names).toContain('friday_sunnah');
  });

  it('every button has non-empty text and an https URL', () => {
    for (const s of withButtons) {
      if (s.kind !== 'message') continue; // narrow for TS
      for (const row of s.buttons!) {
        expect(row.length, `${s.name} has an empty button row`).toBeGreaterThan(0);
        for (const b of row) {
          expect(b.text.trim().length, `${s.name} button text empty`).toBeGreaterThan(0);
          // Telegram inline-button text limit is 64; keep a margin.
          expect(b.text.length, `${s.name} button text too long: ${b.text}`).toBeLessThanOrEqual(
            64,
          );
          expect(b.url, `${s.name} button URL not https: ${b.url}`).toMatch(/^https:\/\//);
        }
      }
      // Telegram allows up to 8 buttons per row; we stay well under.
      for (const row of s.buttons!) {
        expect(row.length, `${s.name} too many buttons in a row`).toBeLessThanOrEqual(8);
      }
    }
  });
});

describe('akhlaq_reminder (daily-rotation library)', () => {
  const akhlaq = findSchedule('akhlaq_reminder');

  it('exists as a message schedule', () => {
    expect(akhlaq?.kind).toBe('message');
  });

  it('walks the pool by daily rotation and keeps every item live', () => {
    // selection 'daily' + keepLast 0 is the whole design: one item a day,
    // deterministic, and nothing is ever deleted so the channel grows a
    // browsable library. A regression to random/replace would silently
    // change the channel's behaviour, so pin both here.
    if (akhlaq?.kind !== 'message') throw new Error('akhlaq_reminder must be a message');
    expect(akhlaq.selection).toBe('daily');
    expect(akhlaq.keepLast).toBe(0);
  });

  it('has an array content pool large enough to rotate without quick repeats', () => {
    if (akhlaq?.kind !== 'message') throw new Error('akhlaq_reminder must be a message');
    expect(Array.isArray(akhlaq.content)).toBe(true);
    expect((akhlaq.content as readonly string[]).length).toBeGreaterThanOrEqual(28);
  });

  it('fires before evening_azkar so the audible azkar sits newest below it', () => {
    const minutes = (cronExpr: string) => {
      const [m, h] = cronExpr.split(/\s+/).map(Number);
      return h * 60 + m;
    };
    const evening = findSchedule('evening_azkar');
    expect(akhlaq && evening).toBeTruthy();
    expect(minutes(akhlaq!.cron)).toBeLessThan(minutes(evening!.cron));
  });
});

describe('poll schedules', () => {
  const pollSchedules = schedules.filter((s) => s.kind === 'poll');

  it('there is exactly one poll schedule (the nightly review)', () => {
    expect(pollSchedules.length).toBe(1);
  });

  // Resolve a schedule's `poll` whether it is a fixed spec or a factory.
  // Day-aware polls (the night review) are recomputed per fire, so
  // tests must exercise both shapes.
  function resolvePoll(p: PollSpec | (() => PollSpec)): PollSpec {
    return typeof p === 'function' ? p() : p;
  }

  function assertPollConstraints(p: PollSpec, label: string) {
    expect(p.question.trim().length, `${label} question empty`).toBeGreaterThan(0);
    // Validate the length we ACTUALLY transmit: lib/post.ts wraps the
    // question + every option in rtlIsolate (RLI..PDI = +2 code
    // points). Telegram's limit applies to the sent string, so a near
    // -limit author string must still fit after the wrap, or sendPoll
    // 400s. Same defensive spirit as the close_date clamp.
    expect(rtlIsolate(p.question).length, `${label} question too long`).toBeLessThanOrEqual(
      MAX_QUESTION_CHARS,
    );

    expect(p.options.length, `${label} options count`).toBeGreaterThanOrEqual(2);
    expect(p.options.length, `${label} options count`).toBeLessThanOrEqual(10);
    for (const opt of p.options) {
      expect(opt.trim().length, `${label} option empty`).toBeGreaterThan(0);
      expect(rtlIsolate(opt).length, `${label} option too long: ${opt}`).toBeLessThanOrEqual(
        MAX_OPTION_CHARS,
      );
    }

    // Options must be distinct, or the percentages are meaningless.
    expect(new Set(p.options).size, `${label} duplicate options`).toBe(p.options.length);

    if (p.closeAfterHours !== undefined) {
      expect(p.closeAfterHours).toBeGreaterThanOrEqual(MIN_CLOSE_HOURS);
      expect(p.closeAfterHours).toBeLessThanOrEqual(MAX_CLOSE_HOURS);
    }
  }

  it('the poll obeys every Telegram constraint', () => {
    for (const s of pollSchedules) {
      if (s.kind !== 'poll') continue; // narrow for TS
      assertPollConstraints(resolvePoll(s.poll), s.name);
    }
  });

  it('the review poll is anonymous and multi-answer (the whole point)', () => {
    const review = findSchedule('night_review_poll');
    expect(review?.kind).toBe('poll');
    if (review?.kind === 'poll') {
      const p = resolvePoll(review.poll);
      // Defaults are anonymous + multi; assert they are not disabled.
      expect(p.isAnonymous).not.toBe(false);
      expect(p.allowsMultipleAnswers).not.toBe(false);
    }
  });

  // buildNightReviewPoll varies by day-of-week in TZ_NAME: Mon/Thu add
  // a «صيام الاثنين/الخميس» option, taking the list to Telegram's max
  // of 10. Iterate every weekday so a future tweak that overflows the
  // limit, drops a key, or duplicates an option fails the suite
  // regardless of which day the CI run happens to be.
  describe('night review poll — day-of-week variants', () => {
    // 2024-12-01 is a Sunday (UTC). Add N days for each weekday.
    const SUNDAY = new Date('2024-12-01T21:45:00Z');
    const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

    for (let i = 0; i < 7; i++) {
      const day = new Date(SUNDAY.getTime() + i * 24 * 60 * 60 * 1000);
      const label = WEEKDAY_NAMES[i];
      it(`${label} variant is valid and within Telegram limits`, () => {
        const spec = buildNightReviewPoll(day, 'UTC');
        assertPollConstraints(spec, `night_review_poll (${label})`);
      });
    }

    it('adds صيام on Monday and Thursday only', () => {
      const mon = buildNightReviewPoll(new Date(SUNDAY.getTime() + 1 * 86400000), 'UTC');
      const thu = buildNightReviewPoll(new Date(SUNDAY.getTime() + 4 * 86400000), 'UTC');
      const wed = buildNightReviewPoll(new Date(SUNDAY.getTime() + 3 * 86400000), 'UTC');

      expect(mon.options.length).toBe(10);
      expect(thu.options.length).toBe(10);
      expect(wed.options.length).toBe(9);

      expect(mon.options.some((o) => o.includes('صيام الاثنين'))).toBe(true);
      expect(thu.options.some((o) => o.includes('صيام الخميس'))).toBe(true);
      expect(wed.options.some((o) => o.includes('صيام'))).toBe(false);
    });

    // The poll reviews TODAY, so on a day nafl fasting is forbidden the
    // «هل صمت؟» option must vanish even though it is Mon/Thu. Mon 2024-06-17
    // = 11 ذو الحجة (أيام التشريق); the fasting bug surfaced exactly here.
    it('drops the fasting option on a Tashreeq Monday', () => {
      const tashreeqMon = buildNightReviewPoll(new Date('2024-06-17T18:45:00Z'), 'Africa/Cairo');
      expect(tashreeqMon.options.some((o) => o.includes('صيام'))).toBe(false);
      expect(tashreeqMon.options.length).toBe(9);
    });

    it('keeps the fasting option on an ordinary Monday', () => {
      // Mon 2024-06-10 = 4 ذو الحجة — fasting allowed.
      const normalMon = buildNightReviewPoll(new Date('2024-06-10T18:45:00Z'), 'Africa/Cairo');
      expect(normalMon.options.some((o) => o.includes('صيام الاثنين'))).toBe(true);
      expect(normalMon.options.length).toBe(10);
    });
  });
});

describe('night_review_poll — "a night yes, a night no" alternation', () => {
  const TZ = 'Africa/Cairo';
  // 21:45 local on three consecutive days (the poll's fire time).
  const d1 = new Date('2026-06-10T18:45:00Z'); // Cairo 21:45
  const d2 = new Date('2026-06-11T18:45:00Z');
  const d3 = new Date('2026-06-12T18:45:00Z');

  it('the poll carries a skipIf guard (it does not fire nightly)', () => {
    const poll = findSchedule('night_review_poll');
    expect(poll?.skipIf).toBeTypeOf('function');
  });

  it('isPollNight flips every calendar day (send one night, skip the next)', () => {
    expect(isPollNight(d1, TZ)).not.toBe(isPollNight(d2, TZ));
    expect(isPollNight(d2, TZ)).not.toBe(isPollNight(d3, TZ));
    // ...so consecutive days never match, across a longer span too.
    for (let i = 0; i < 12; i++) {
      const a = new Date(d1.getTime() + i * 86400000);
      const b = new Date(d1.getTime() + (i + 1) * 86400000);
      expect(isPollNight(a, TZ)).not.toBe(isPollNight(b, TZ));
    }
  });

  it('is deterministic for a given calendar date (restart-safe, no saved state)', () => {
    // Two different instants on the SAME Cairo day → same verdict.
    const morning = new Date('2026-06-10T05:00:00Z'); // Cairo 08:00, 10 Jun
    const evening = new Date('2026-06-10T20:00:00Z'); // Cairo 23:00, 10 Jun
    expect(isPollNight(morning, TZ)).toBe(isPollNight(evening, TZ));
  });

  it('keys off the local calendar date, not the host clock (tz-aware)', () => {
    // 23:30 UTC on 10 Jun is already 11 Jun in Cairo (UTC+3 → 02:30), so the
    // two zones can land on different parity for the same instant.
    const instant = new Date('2026-06-10T23:30:00Z');
    expect(isPollNight(instant, 'UTC')).not.toBe(isPollNight(instant, TZ));
  });

  it('the schedule skipIf agrees with isPollNight (skip = not a poll night)', () => {
    const poll = findSchedule('night_review_poll');
    expect(poll?.skipIf!(d1)).toBe(!isPollNight(d1, TZ));
    expect(poll?.skipIf!(d2)).toBe(!isPollNight(d2, TZ));
  });
});

describe('fasting_reminder no-fast guard', () => {
  // The reminder fires Sun/Wed evening about TOMORROW's fast, so its
  // skipIf suppresses it when tomorrow is Eid / أيام التشريق.
  const reminder = findSchedule('fasting_reminder');

  it('has a skipIf guard', () => {
    expect(reminder?.skipIf).toBeTypeOf('function');
  });

  it('skips the Sunday nudge before a Tashreeq Monday, fires on an ordinary night', () => {
    // Sun 2024-06-16 (Eid) eve → tomorrow Mon 06-17 = 11 ذو الحجة → skip.
    expect(reminder!.skipIf!(new Date('2024-06-16T18:40:00Z'))).toBe(true);
    // Sun 2024-06-09 → tomorrow Mon 06-10 = 4 ذو الحجة → fire.
    expect(reminder!.skipIf!(new Date('2024-06-09T18:40:00Z'))).toBe(false);
  });
});

// A real, recent incident, pinned as a regression: Eid al-Adha 1447 fell
// on Wed 2026-05-27 (Umm al-Qura, Cairo), so Thu 2026-05-28 was 11 ذو
// الحجة — the first day of أيام التشريق. Before the fix the Wednesday-eve
// nudge told people to fast that Thursday and the Thursday-night poll
// offered «صيام الخميس». Both must now be gone, and the reminder must
// resume the moment Tashreeq ends.
describe('regression — أيام التشريق 1447 (Thu 2026-05-28)', () => {
  const TZ = 'Africa/Cairo';
  const reminder = findSchedule('fasting_reminder')!;

  it('confirms Thu 2026-05-28 really was a Tashreeq day (11 ذو الحجة)', () => {
    expect(hijriDate(new Date('2026-05-28T18:00:00Z'), TZ)).toEqual({ month: 12, day: 11 });
  });

  it('suppresses the Wednesday-eve nudge that caused the bug', () => {
    // fasting_reminder fires Wed 2026-05-27 evening, about Thu 2026-05-28.
    expect(reminder.skipIf!(new Date('2026-05-27T18:40:00Z'))).toBe(true);
  });

  it('drops «صيام» from that Thursday night’s review poll', () => {
    const poll = buildNightReviewPoll(new Date('2026-05-28T18:45:00Z'), TZ);
    expect(poll.options.some((o) => o.includes('صيام'))).toBe(false);
    expect(poll.options.length).toBe(9);
  });

  it('resumes once Tashreeq ends — fires again for Mon 2026-06-01 (15 ذو الحجة)', () => {
    // Sun 2026-05-31 (14 ذو الحجة, the +1 cushion) eve → tomorrow Mon
    // 06-01 = 15 ذو الحجة, fasting allowed again → nudge fires.
    expect(reminder.skipIf!(new Date('2026-05-31T18:40:00Z'))).toBe(false);
  });
});

describe('bedtime window order', () => {
  // Guards the documented design: pre_sleep fires BEFORE night_review_poll,
  // so the poll is the last message in the channel. A user who sees the
  // gap «سورة المُلك وأذكار النوم» in the poll scrolls UP to the pre-sleep
  // message above it and acts on the dhikr. See schedules.ts header.
  function minutesFromTopOfDay(cronExpr: string): number {
    const [m, h] = cronExpr.split(/\s+/).map(Number);
    return h * 60 + m;
  }

  it('pre_sleep fires before night_review_poll on the same day', () => {
    const presleep = findSchedule('pre_sleep');
    const poll = findSchedule('night_review_poll');
    expect(presleep, 'pre_sleep must exist').toBeDefined();
    expect(poll, 'night_review_poll must exist').toBeDefined();
    expect(minutesFromTopOfDay(presleep!.cron)).toBeLessThan(minutesFromTopOfDay(poll!.cron));
  });
});

describe('notification sessions (silent riders)', () => {
  // The documented design: each session rings once. The anchors ring; the
  // posts co-scheduled a minute later ride along silently. See schedules.ts.
  const AUDIBLE = ['morning_azkar', 'evening_azkar', 'night_review_poll'];
  const SILENT = ['akhlaq_reminder', 'friday_sunnah', 'fasting_reminder', 'pre_sleep'];

  it('rides the Friday/fasting/pre-sleep posts in silently', () => {
    for (const name of SILENT) {
      expect(findSchedule(name)?.silent, `${name} should be silent`).toBe(true);
    }
  });

  it('lets the three anchors ring (one ping per session)', () => {
    for (const name of AUDIBLE) {
      // silent is undefined or false on an anchor; never true.
      expect(findSchedule(name)?.silent, `${name} should ring`).not.toBe(true);
    }
  });

  it('classifies every schedule as exactly one of anchor or rider', () => {
    expect(new Set([...AUDIBLE, ...SILENT])).toEqual(new Set(schedules.map((s) => s.name)));
  });
});

describe('findSchedule', () => {
  it('finds a schedule by name', () => {
    const first = schedules[0];
    expect(findSchedule(first.name)?.name).toBe(first.name);
  });

  it('returns undefined for an unknown name', () => {
    expect(findSchedule('definitely-not-real')).toBeUndefined();
  });
});
