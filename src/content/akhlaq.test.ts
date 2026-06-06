import { describe, it, expect } from 'vitest';
import { akhlaqReminders } from './akhlaq';
import { pickForDay } from 'telegram-broadcast-kit';

/**
 * The akhlaq library is an evergreen pool walked one item a day by
 * deterministic rotation (schedules.ts: akhlaq_reminder, selection
 * 'daily', keepLast 0). These tests guard the pool's health and the
 * rotation's no-consecutive-repeat property. No network, no DB.
 */

// Telegram single-message hard limit. Our vignettes are far shorter, but
// guard against a future edit that accidentally pastes a huge block.
const MAX_MESSAGE = 4096;

describe('akhlaqReminders', () => {
  it('has a healthy pool (room for ~a month without repeats)', () => {
    expect(akhlaqReminders.length).toBeGreaterThanOrEqual(28);
  });

  it('every vignette is non-blank and within sensible limits', () => {
    for (const item of akhlaqReminders) {
      expect(item.trim().length).toBeGreaterThan(0);
      expect(item.length).toBeLessThanOrEqual(MAX_MESSAGE);
      // Keep them short and readable, not walls of text.
      expect(item.length, `too long: ${item.slice(0, 40)}…`).toBeLessThanOrEqual(900);
    }
  });

  it('has no duplicate vignettes', () => {
    expect(new Set(akhlaqReminders).size).toBe(akhlaqReminders.length);
  });

  it('every vignette opens with one of the four stream emoji', () => {
    // The leading emoji is the stream marker (🌿 khuluq, 🌟 hady, 🕊️ sahaba,
    // 💎 hikma). A vignette missing it would render as an untagged blob.
    const markers = ['🌿', '🌟', '🕊️', '💎'];
    for (const item of akhlaqReminders) {
      expect(
        markers.some((m) => item.startsWith(m)),
        `missing stream emoji: ${item.slice(0, 30)}…`,
      ).toBe(true);
    }
  });

  it('daily rotation never repeats on consecutive days (4 years, incl. leap 2028)', () => {
    // Walk 4 real years starting 2026-01-01 (crosses the 2028 leap day and
    // three Jan-1 day-counter resets), so the tricky boundaries are covered.
    let day = new Date('2026-01-01T16:58:00Z');
    for (let i = 0; i < 365 * 4 + 1; i++) {
      const next = new Date(day.getTime() + 86_400_000);
      expect(pickForDay(akhlaqReminders, day, 'Africa/Cairo')).not.toBe(
        pickForDay(akhlaqReminders, next, 'Africa/Cairo'),
      );
      day = next;
    }
  });

  it('no item repeats within ~3 weeks (a reasonable spacing all year)', () => {
    // The gap between two showings of the same item is normally the list
    // size in days, but on Jan 1 the day counter resets, which can shorten
    // it. How short depends a lot on the list size (e.g. 40 or 45 items drop
    // it to ~5 days; 41 keeps it at 37). This test pins a healthy minimum so
    // a future size change can't quietly make the channel feel repetitive.
    // If it fails, the list size is a bad value: change it by 1 and re-run.
    const MIN_GAP_DAYS = 21;
    const start = Date.UTC(2026, 0, 1, 13, 58);
    const lastSeen: Record<string, number> = {};
    let minGap = Infinity;
    for (let d = 0; d < 365 * 4 + 1; d++) {
      const date = new Date(start + d * 86_400_000);
      const pick = pickForDay(akhlaqReminders, date, 'Africa/Cairo')!;
      if (lastSeen[pick] !== undefined) minGap = Math.min(minGap, d - lastSeen[pick]);
      lastSeen[pick] = d;
    }
    expect(minGap).toBeGreaterThanOrEqual(MIN_GAP_DAYS);
  });
});
