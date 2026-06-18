import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { cardThemeFor, cardFor, azkarCard } from './cards';

/**
 * The azkar cards alternate light/dark by civil date in config.timezone, so
 * all three azkar share a day's theme and consecutive days swap. These pin
 * that alternation (and that the image files actually exist). No network.
 */

const TZ = 'Africa/Cairo';

describe('cardThemeFor', () => {
  it('alternates light/dark on consecutive civil days', () => {
    const d1 = new Date('2026-06-18T05:31:00Z');
    const d2 = new Date('2026-06-19T05:31:00Z');
    const d3 = new Date('2026-06-20T05:31:00Z');
    expect(cardThemeFor(d1, TZ)).not.toBe(cardThemeFor(d2, TZ));
    expect(cardThemeFor(d2, TZ)).not.toBe(cardThemeFor(d3, TZ));
    expect(cardThemeFor(d1, TZ)).toBe(cardThemeFor(d3, TZ));
  });

  it('is deterministic per date+tz (stateless, restart-safe)', () => {
    const d = new Date('2026-06-18T05:31:00Z');
    expect(cardThemeFor(d, TZ)).toBe(cardThemeFor(d, TZ));
  });

  it('all three azkar times on the same civil day share one theme', () => {
    // morning ~05:31, evening ~16:58, pre-sleep ~21:43 Cairo — same day.
    const morning = new Date('2026-06-18T02:31:00Z');
    const evening = new Date('2026-06-18T13:58:00Z');
    const night = new Date('2026-06-18T18:43:00Z');
    const theme = cardThemeFor(morning, TZ);
    expect(cardThemeFor(evening, TZ)).toBe(theme);
    expect(cardThemeFor(night, TZ)).toBe(theme);
  });

  it('keys off the tz civil date, not the host clock', () => {
    // 23:30Z is still 18 Jun in UTC but already 19 Jun in Cairo (UTC+2/+3),
    // a different day-parity — so the tz must change the verdict.
    const instant = new Date('2026-06-18T23:30:00Z');
    expect(cardThemeFor(instant, 'Africa/Cairo')).not.toBe(cardThemeFor(instant, 'UTC'));
  });
});

describe('azkarCard / cardFor', () => {
  it('builds light + dark paths that exist on disk', () => {
    for (const base of ['morningAzkar', 'eveningAzkar', 'preSleep']) {
      const pair = azkarCard(base);
      expect(existsSync(pair.light), `missing ${pair.light}`).toBe(true);
      expect(existsSync(pair.dark), `missing ${pair.dark}`).toBe(true);
    }
  });

  it('cardFor picks light or dark from the pair by day', () => {
    const pair = azkarCard('morningAzkar');
    const light = cardFor(pair, new Date('2026-06-18T05:31:00Z'), TZ);
    const dark = cardFor(pair, new Date('2026-06-19T05:31:00Z'), TZ);
    expect([pair.light, pair.dark]).toContain(light);
    expect([pair.light, pair.dark]).toContain(dark);
    expect(light).not.toBe(dark);
  });
});
