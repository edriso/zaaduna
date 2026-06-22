import { describe, it, expect } from 'vitest';
import { hijriDate, noFastReason, fastForbiddenTomorrow, specialFastDay } from './hijri';

/**
 * The Hijri layer decides which days nafl fasting is forbidden, so the
 * fasting nudges never command a fast on Eid / أيام التشريق (the bug that
 * shipped once). All cases use fixed Gregorian dates whose Umm al-Qura
 * mapping is known, so the suite is deterministic — no clock, no network.
 *
 * Anchor year 1445/1446 AH (verified against Umm al-Qura):
 *   2024-06-15 = 9 ذو الحجة (عرفة)   2024-06-16 = 10 (عيد الأضحى)
 *   2024-06-17..19 = 11..13 (تشريق)  2024-06-20 = 14   2024-06-21 = 15
 *   2025-03-30 = 1 شوّال (عيد الفطر)  2025-03-31 = 2 شوّال
 *
 * Times are ~18:40Z ≈ 21:40 Cairo (the real fire time, DST+3 in June), to
 * prove time-of-day never flips the calendar day.
 */

const TZ = 'Africa/Cairo';
const at = (iso: string) => new Date(`${iso}T18:40:00Z`);

describe('hijriDate', () => {
  it('maps known civil days to Umm al-Qura month/day', () => {
    expect(hijriDate(at('2024-06-16'), TZ)).toEqual({ month: 12, day: 10 });
    expect(hijriDate(at('2025-03-30'), TZ)).toEqual({ month: 10, day: 1 });
  });

  it('reads the date in tz, not the host (a late-evening instant stays the same day)', () => {
    // 22:40 Cairo on the 16th is still the 16th locally → 10 ذو الحجة.
    expect(hijriDate(new Date('2024-06-16T19:40:00Z'), TZ)).toEqual({ month: 12, day: 10 });
  });
});

describe('noFastReason (offset 0 = the day itself)', () => {
  it('flags عيد الفطر — شوّال 1 only, never the ستّ من شوّال that follow', () => {
    expect(noFastReason(at('2025-03-30'), TZ)).toBe('eid-fitr');
    expect(noFastReason(at('2025-03-31'), TZ)).toBeNull(); // شوّال 2 — Sunnah fast, must stand
  });

  it('flags عيد الأضحى and the three أيام التشريق', () => {
    expect(noFastReason(at('2024-06-16'), TZ)).toBe('eid-adha'); // 10
    expect(noFastReason(at('2024-06-17'), TZ)).toBe('tashreeq'); // 11
    expect(noFastReason(at('2024-06-18'), TZ)).toBe('tashreeq'); // 12
    expect(noFastReason(at('2024-06-19'), TZ)).toBe('tashreeq'); // 13
  });

  it('applies the +1 forward cushion (day 14) but stops there (day 15 is free)', () => {
    expect(noFastReason(at('2024-06-20'), TZ)).toBe('tashreeq'); // 14 — late-sighting cushion
    expect(noFastReason(at('2024-06-21'), TZ)).toBeNull(); // 15 — back to normal
  });

  it('NEVER suppresses يوم عرفة (ذو الحجة 9) — the asymmetry that protects the best fast', () => {
    expect(noFastReason(at('2024-06-15'), TZ)).toBeNull(); // 9 — Arafah
    expect(noFastReason(at('2024-06-14'), TZ)).toBeNull(); // 8
  });

  it('returns null on an ordinary day', () => {
    expect(noFastReason(at('2024-06-10'), TZ)).toBeNull(); // 4 ذو الحجة
  });
});

describe('fastForbiddenTomorrow (the reminder is about TOMORROW)', () => {
  it('suppresses the Sunday nudge for a Tashreeq Monday — the exact bug that shipped', () => {
    // Sunday 2024-06-16 (Eid) evening → tomorrow Mon 06-17 = 11 ذو الحجة.
    expect(fastForbiddenTomorrow(at('2024-06-16'), TZ)).toBe(true);
  });

  it('does NOT suppress when tomorrow is عرفة', () => {
    // Eve of Arafah → tomorrow 06-15 = 9 ذو الحجة. Keep encouraging it.
    expect(fastForbiddenTomorrow(at('2024-06-14'), TZ)).toBe(false);
  });

  it('does not suppress an ordinary night', () => {
    // Sunday 06-09 → tomorrow Mon 06-10 = 4 ذو الحجة.
    expect(fastForbiddenTomorrow(at('2024-06-09'), TZ)).toBe(false);
  });
});

describe('specialFastDay (offset 0 = the day itself)', () => {
  it('flags عرفة, تاسوعاء, عاشوراء on their exact days', () => {
    expect(specialFastDay(at('2024-06-15'), TZ)).toBe('arafah'); // ذو الحجة 9
    expect(specialFastDay(at('2026-06-24'), TZ)).toBe('tasua'); // محرّم 9
    expect(specialFastDay(at('2026-06-25'), TZ)).toBe('ashura'); // محرّم 10
  });

  it('flags the أيّام البيض (13–15) of an ordinary month', () => {
    expect(specialFastDay(at('2026-06-28'), TZ)).toBe('ayyam-bid'); // محرّم 13
    expect(specialFastDay(at('2026-06-30'), TZ)).toBe('ayyam-bid'); // محرّم 15
    expect(specialFastDay(at('2026-07-01'), TZ)).toBeNull(); // محرّم 16 — back to normal
  });

  it('does NOT flag البيض in رمضان (whole month already fasted)', () => {
    expect(specialFastDay(at('2025-03-13'), TZ)).toBeNull(); // رمضان 13
  });

  it('does NOT flag البيض in ذو الحجة (Tashreeq overlap / contested)', () => {
    expect(specialFastDay(at('2024-06-19'), TZ)).toBeNull(); // ذو الحجة 13 (تشريق)
    expect(specialFastDay(at('2024-06-21'), TZ)).toBeNull(); // ذو الحجة 15
  });

  it('returns null on an ordinary day', () => {
    expect(specialFastDay(at('2024-06-10'), TZ)).toBeNull(); // ذو الحجة 4
  });

  it('reads TOMORROW with offset 1 (used to merge the generic Mon/Thu nudge)', () => {
    // Wed eve 2026-06-24 → tomorrow Thu 06-25 = عاشوراء.
    expect(specialFastDay(at('2026-06-24'), TZ, 1)).toBe('ashura');
  });
});
