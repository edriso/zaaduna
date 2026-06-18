import { describe, it, expect } from 'vitest';
import { adabQuizzes, buildWeeklyQuiz, weekNumberInTz } from './quiz';
import { rtlIsolate, MIN_CLOSE_HOURS, MAX_CLOSE_HOURS } from 'telegram-broadcast-kit';

/**
 * The weekly situational-adab quiz (schedules.ts: friday_quiz). A Telegram
 * quiz poll: one correct answer + an explanation shown after voting,
 * anonymous, rotated weekly through the pool. These guard the pool against
 * Telegram's limits and pin the weekly rotation. No network, no DB.
 */

// Telegram caps, with the margins the rest of the bot keeps.
const MAX_QUESTION = 255; // Telegram 300; rtlIsolate adds 2; we keep margin.
const MAX_OPTION = 100;
const MAX_EXPLANATION = 200;

describe('adabQuizzes (pool)', () => {
  it('has a healthy pool (months of weekly rotation)', () => {
    expect(adabQuizzes.length).toBeGreaterThanOrEqual(12);
  });

  it('each quiz obeys Telegram quiz constraints', () => {
    adabQuizzes.forEach((q, i) => {
      const label = `quiz #${i}`;
      expect(q.situation.trim().length, `${label} situation empty`).toBeGreaterThan(0);

      // 2..4 options, each within the length cap after the rtlIsolate wrap.
      expect(q.options.length, `${label} option count`).toBeGreaterThanOrEqual(2);
      expect(q.options.length, `${label} option count`).toBeLessThanOrEqual(4);
      for (const opt of q.options) {
        expect(opt.trim().length, `${label} empty option`).toBeGreaterThan(0);
        expect(rtlIsolate(opt).length, `${label} option too long: ${opt}`).toBeLessThanOrEqual(
          MAX_OPTION,
        );
      }
      // Distinct options, or the "correct" answer is ambiguous.
      expect(new Set(q.options).size, `${label} duplicate options`).toBe(q.options.length);

      // correctIndex must point at a real option.
      expect(Number.isInteger(q.correctIndex), `${label} correctIndex not int`).toBe(true);
      expect(q.correctIndex, `${label} correctIndex range`).toBeGreaterThanOrEqual(0);
      expect(q.correctIndex, `${label} correctIndex range`).toBeLessThan(q.options.length);

      // Explanation: Telegram caps it at 200 chars with at most 2 line breaks.
      expect(q.explanation.length, `${label} explanation too long`).toBeLessThanOrEqual(
        MAX_EXPLANATION,
      );
      expect(
        q.explanation.split('\n').length - 1,
        `${label} explanation has >2 line breaks`,
      ).toBeLessThanOrEqual(2);
    });
  });

  it('does not always put the correct answer in the same slot', () => {
    // A fixed correct position would become a tell. Expect at least two
    // distinct correctIndex values across the pool.
    expect(new Set(adabQuizzes.map((q) => q.correctIndex)).size).toBeGreaterThanOrEqual(2);
  });
});

describe('buildWeeklyQuiz', () => {
  const TZ = 'Africa/Cairo';
  const aFriday = new Date('2026-06-19T14:00:00Z');

  it('builds a valid anonymous quiz PollSpec', () => {
    const s = buildWeeklyQuiz(aFriday, TZ);
    expect(s.type).toBe('quiz');
    expect(s.isAnonymous).toBe(true);
    expect(s.correctOptionId).toBeTypeOf('number');
    expect(s.correctOptionId!).toBeGreaterThanOrEqual(0);
    expect(s.correctOptionId!).toBeLessThan(s.options.length);
    expect(rtlIsolate(s.question).length, 'question too long').toBeLessThanOrEqual(MAX_QUESTION);
    expect(s.explanation!.length).toBeLessThanOrEqual(MAX_EXPLANATION);
    // The picked scenario's situation is carried in the question text.
    const picked = adabQuizzes[weekNumberInTz(aFriday, TZ) % adabQuizzes.length];
    expect(s.question.endsWith(picked.situation)).toBe(true);
    expect(s.options).toEqual(picked.options);
    expect(s.correctOptionId).toBe(picked.correctIndex);
  });

  it('keeps close_date inside the kit clamp window', () => {
    const s = buildWeeklyQuiz(aFriday, TZ);
    expect(s.closeAfterHours!).toBeGreaterThanOrEqual(MIN_CLOSE_HOURS);
    expect(s.closeAfterHours!).toBeLessThanOrEqual(MAX_CLOSE_HOURS);
  });

  it('rotates weekly: consecutive Fridays differ, same week is stable', () => {
    const nextFriday = new Date(aFriday.getTime() + 7 * 86_400_000);
    const sameWeek = new Date(aFriday.getTime() + 2 * 86_400_000); // +2 days, same week index
    expect(weekNumberInTz(nextFriday, TZ)).toBe(weekNumberInTz(aFriday, TZ) + 1);
    expect(buildWeeklyQuiz(nextFriday, TZ).question).not.toBe(
      buildWeeklyQuiz(aFriday, TZ).question,
    );
    // A pool > 1 guarantees consecutive weeks pick different scenarios.
    if (adabQuizzes.length > 1) {
      expect(buildWeeklyQuiz(sameWeek, TZ).question).toBe(buildWeeklyQuiz(aFriday, TZ).question);
    }
  });

  it('is deterministic per date+tz (stateless, restart-safe)', () => {
    expect(buildWeeklyQuiz(aFriday, TZ).question).toBe(buildWeeklyQuiz(aFriday, TZ).question);
  });

  it('walks the whole pool before repeating (no consecutive-week repeat)', () => {
    let prev = '';
    for (let w = 0; w < adabQuizzes.length; w++) {
      const day = new Date(aFriday.getTime() + w * 7 * 86_400_000);
      const q = buildWeeklyQuiz(day, TZ).question;
      if (prev) expect(q, `week ${w} repeats the previous week`).not.toBe(prev);
      prev = q;
    }
  });
});
