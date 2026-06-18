import { describe, it, expect } from 'vitest';
import { adabReminders } from './adab';
import { pickForDay } from 'telegram-broadcast-kit';

/**
 * The morning «adab & sunan & heart» library: an evergreen pool walked one
 * item a day by deterministic rotation (schedules.ts: morning_adab,
 * selection 'daily', keepLast 0), independent of the evening akhlaq pool.
 * These mirror akhlaq.test.ts — pool health + the no-consecutive-repeat and
 * minimum-spacing properties. No network, no DB.
 */

const MAX_MESSAGE = 4096;

describe('adabReminders', () => {
  it('has a healthy pool (months of rotation without repeats)', () => {
    expect(adabReminders.length).toBeGreaterThanOrEqual(28);
  });

  it('every vignette is non-blank and within sensible limits', () => {
    for (const item of adabReminders) {
      expect(item.trim().length).toBeGreaterThan(0);
      expect(item.length).toBeLessThanOrEqual(MAX_MESSAGE);
      expect(item.length, `too long: ${item.slice(0, 40)}…`).toBeLessThanOrEqual(900);
    }
  });

  it('has no duplicate vignettes', () => {
    expect(new Set(adabReminders).size).toBe(adabReminders.length);
  });

  it('every vignette opens with one of the three stream emoji', () => {
    // 📿 sunan/adab, 🤲 heart, 🚫 a trait to avoid. A vignette missing it
    // would render as an untagged blob.
    const markers = ['📿', '🤲', '🚫'];
    for (const item of adabReminders) {
      expect(
        markers.some((m) => item.startsWith(m)),
        `missing stream emoji: ${item.slice(0, 30)}…`,
      ).toBe(true);
    }
  });

  it('daily rotation never repeats on consecutive days (4 years, incl. leap 2028)', () => {
    let day = new Date('2026-01-01T05:31:00Z');
    for (let i = 0; i < 365 * 4 + 1; i++) {
      const next = new Date(day.getTime() + 86_400_000);
      expect(pickForDay(adabReminders, day, 'Africa/Cairo')).not.toBe(
        pickForDay(adabReminders, next, 'Africa/Cairo'),
      );
      day = next;
    }
  });

  it('no item repeats within ~3 weeks (a healthy spacing all year)', () => {
    // Same Jan-1-reset concern as the akhlaq library: a bad list size can
    // shorten the shortest gap. Pin a healthy minimum; if this fails, change
    // the count by 1 and re-run (see the note in adab.ts).
    const MIN_GAP_DAYS = 21;
    const start = Date.UTC(2026, 0, 1, 3, 31);
    const lastSeen: Record<string, number> = {};
    let minGap = Infinity;
    for (let d = 0; d < 365 * 4 + 1; d++) {
      const date = new Date(start + d * 86_400_000);
      const pick = pickForDay(adabReminders, date, 'Africa/Cairo')!;
      if (lastSeen[pick] !== undefined) minGap = Math.min(minGap, d - lastSeen[pick]);
      lastSeen[pick] = d;
    }
    expect(minGap).toBeGreaterThanOrEqual(MIN_GAP_DAYS);
  });
});
