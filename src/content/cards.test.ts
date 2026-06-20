import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { cardVariantFor, cardFor, azkarCard } from './cards';

/**
 * The azkar cards alternate between variant 1 and variant 2 by civil date in
 * config.timezone, so all three azkar share a day's variant and consecutive
 * days swap. These pin that alternation (and that the image files actually
 * exist). No network.
 */

const TZ = 'Africa/Cairo';

describe('cardVariantFor', () => {
  it('alternates the variant on consecutive civil days', () => {
    const d1 = new Date('2026-06-18T05:31:00Z');
    const d2 = new Date('2026-06-19T05:31:00Z');
    const d3 = new Date('2026-06-20T05:31:00Z');
    expect(cardVariantFor(d1, TZ)).not.toBe(cardVariantFor(d2, TZ));
    expect(cardVariantFor(d2, TZ)).not.toBe(cardVariantFor(d3, TZ));
    expect(cardVariantFor(d1, TZ)).toBe(cardVariantFor(d3, TZ));
  });

  it('is deterministic per date+tz (stateless, restart-safe)', () => {
    const d = new Date('2026-06-18T05:31:00Z');
    expect(cardVariantFor(d, TZ)).toBe(cardVariantFor(d, TZ));
  });

  it('all three azkar times on the same civil day share one variant', () => {
    // morning ~05:31, evening ~16:58, pre-sleep ~21:43 Cairo — same day.
    const morning = new Date('2026-06-18T02:31:00Z');
    const evening = new Date('2026-06-18T13:58:00Z');
    const night = new Date('2026-06-18T18:43:00Z');
    const variant = cardVariantFor(morning, TZ);
    expect(cardVariantFor(evening, TZ)).toBe(variant);
    expect(cardVariantFor(night, TZ)).toBe(variant);
  });

  it('keys off the tz civil date, not the host clock', () => {
    // 23:30Z is still 18 Jun in UTC but already 19 Jun in Cairo (UTC+2/+3),
    // a different day-parity — so the tz must change the verdict.
    const instant = new Date('2026-06-18T23:30:00Z');
    expect(cardVariantFor(instant, 'Africa/Cairo')).not.toBe(cardVariantFor(instant, 'UTC'));
  });
});

describe('azkarCard / cardFor', () => {
  it('builds variant 1 + 2 paths that exist on disk', () => {
    for (const base of ['morning-azkar', 'evening-azkar', 'pre-sleep-azkar']) {
      const pair = azkarCard(base);
      expect(existsSync(pair.first), `missing ${pair.first}`).toBe(true);
      expect(existsSync(pair.second), `missing ${pair.second}`).toBe(true);
    }
  });

  it('cardFor picks variant 1 or 2 from the pair by day', () => {
    const pair = azkarCard('morning-azkar');
    const first = cardFor(pair, new Date('2026-06-18T05:31:00Z'), TZ);
    const second = cardFor(pair, new Date('2026-06-19T05:31:00Z'), TZ);
    expect([pair.first, pair.second]).toContain(first);
    expect([pair.first, pair.second]).toContain(second);
    expect(first).not.toBe(second);
  });
});
