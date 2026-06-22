/**
 * Hijri-calendar awareness for the fasting nudges — the ONE place that
 * knows which days nafl (voluntary) fasting is forbidden, so the Mon/Thu
 * reminder and the nightly poll's fasting option never tell anyone to
 * fast on a day the Sharīʿah forbids it (the bug that shipped once: a
 * «صيام الإثنين» nudge on the second day of عيد الأضحى — an أيام التشريق
 * day).
 *
 * Built on the Umm al-Qura calendar baked into Node's ICU
 * (`-u-ca-islamic-umalqura`). Same discipline as `weekdayInTz` in
 * content/poll.ts: the date is read in the configured timezone, never
 * from the host clock.
 *
 * DESIGN — narrow, asymmetric, Arafah-aware (see CLAUDE.md too):
 *   Umm al-Qura is a *calculated* table; the official crescent sighting
 *   can complete a month to 30 days, pushing the real religious date up
 *   to ONE day LATER than the printed table. We defend against that
 *   one-day drift WITHOUT over-suppressing:
 *
 *     • شوّال ١              — عيد الفطر. No cushion: شوّال ٢ onward is the
 *                              ستّ من شوّال Sunnah fast, must NOT be killed.
 *     • ذو الحجة ١٠          — عيد الأضحى (يوم النحر).
 *     • ذو الحجة ١١،١٢،١٣    — أيام التشريق.
 *     • ذو الحجة ١٤          — +1 FORWARD cushion ONLY, for the late-sighting
 *                              drift (the calc's «14th» may be the real
 *                              13th). Forward-only on purpose: a backward
 *                              cushion onto ذو الحجة ٩ would suppress يوم
 *                              عرفة — the most virtuous nafl fast of the
 *                              year — so we never extend that way.
 *
 *   The rare opposite drift (sighting EARLIER than the table) is left to
 *   the pinned welcome.ts caveat and the reader's own knowledge of when
 *   Eid falls locally: the calendar is a strong filter, not the sole
 *   authority. We never trust the calculation alone for a worship ruling.
 */

/** Why nafl fasting is forbidden on a given day (for logs). */
export type NoFastReason = 'eid-fitr' | 'eid-adha' | 'tashreeq';

/** The Gregorian Y-M-D of `instant` as seen in `tz` (en-CA → ISO order). */
function gregorianYMDInTz(instant: Date, tz: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/**
 * Umm al-Qura month/day of a civil calendar day. Anchored at NOON UTC so
 * the civil day is unambiguous (no midnight/DST edge can flip it), and the
 * Hijri date of a civil day is the same for every reader's timezone.
 * `day` may overflow (e.g. 31) — Date.UTC normalises it into the next
 * month, which is exactly how the +1 forward cushion crosses a boundary.
 */
function hijriOfCivilDay(y: number, m: number, day: number): { month: number; day: number } {
  const noonUtc = new Date(Date.UTC(y, m - 1, day, 12));
  const parts = new Intl.DateTimeFormat('en-US-u-ca-islamic-umalqura', {
    timeZone: 'UTC',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(noonUtc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { month: get('month'), day: get('day') };
}

/** The Umm al-Qura { month, day } for `instant` read in `tz`. Exported
 *  for tests and diagnostics. Months: 10 = شوّال, 12 = ذو الحجة. */
export function hijriDate(instant: Date, tz: string): { month: number; day: number } {
  const { y, m, d } = gregorianYMDInTz(instant, tz);
  return hijriOfCivilDay(y, m, d);
}

/**
 * Is the day `offsetDays` from `instant` (read in `tz`) one on which nafl
 * fasting is forbidden? Returns the reason, or null. See the file header
 * for the exact windows and why the cushion is forward-only.
 *
 * offsetDays = 0 → the day of `instant` itself (the poll reviews TODAY).
 * offsetDays = 1 → the next day (the Sun/Wed reminder is about TOMORROW).
 */
export function noFastReason(instant: Date, tz: string, offsetDays = 0): NoFastReason | null {
  const { y, m, d } = gregorianYMDInTz(instant, tz);
  const { month, day } = hijriOfCivilDay(y, m, d + offsetDays);

  if (month === 10 && day === 1) return 'eid-fitr'; // عيد الفطر — no cushion
  if (month === 12 && day === 10) return 'eid-adha'; // يوم النحر
  if (month === 12 && day >= 11 && day <= 14) return 'tashreeq'; // 11–13 + day-14 cushion
  return null;
}

/**
 * True if the day AFTER `now` — the day a Sunday/Wednesday-evening
 * fasting reminder is about — is one on which nafl fasting is forbidden.
 * Used as the fasting_reminder `skipIf` guard. Pure, so it is unit-tested
 * against fixed dates without a clock or network.
 */
export function fastForbiddenTomorrow(now: Date, tz: string): boolean {
  return noFastReason(now, tz, 1) !== null;
}

/**
 * A special, season-bound recommended nafl fast that warrants its own
 * reminder (and its own night-poll label), beyond the weekly Mon/Thu rhythm.
 */
export type SpecialFastDay = 'arafah' | 'tasua' | 'ashura' | 'ayyam-bid';

/**
 * Which special recommended nafl fast, if any, falls on the day `offsetDays`
 * from `instant` (read in `tz`). Returns the occasion or null.
 *
 *   • 'arafah'    — ذو الحجة ٩ (يوم عرفة) — for non-pilgrims; the best nafl
 *                   fast of the year. Never an Eid/Tashreeq day by definition.
 *   • 'tasua'     — محرّم ٩ (تاسوعاء).
 *   • 'ashura'    — محرّم ١٠ (عاشوراء).
 *   • 'ayyam-bid' — ١٣/١٤/١٥ of a Hijri month, EXCEPT:
 *                     - رمضان (month 9): the whole month is already fasted, so
 *                       the «three white days» reminder makes no sense.
 *                     - ذو الحجة (month 12): the 13th (and the +1-cushion 14th)
 *                       are أيام التشريق (see noFastReason), and the البيض of
 *                       that month are contested — so we leave it to the plain
 *                       Mon/Thu rhythm rather than risk nudging a forbidden day.
 *
 * Used to (a) MERGE: suppress the generic Mon/Thu nudge when TOMORROW is one of
 * these (its own richer reminder already covers it), and (b) RELABEL the night
 * poll's fasting tick with the occasion. Pure + tz-keyed, same discipline as
 * noFastReason; unit-tested against fixed dates. عاشوراء/تاسوعاء/عرفة are never
 * Eid/Tashreeq, and البيض excludes ذو الحجة, so a non-null result is always a
 * day nafl fasting is permitted (no extra noFastReason check needed).
 */
export function specialFastDay(instant: Date, tz: string, offsetDays = 0): SpecialFastDay | null {
  const { y, m, d } = gregorianYMDInTz(instant, tz);
  const { month, day } = hijriOfCivilDay(y, m, d + offsetDays);

  if (month === 12 && day === 9) return 'arafah';
  if (month === 1 && day === 9) return 'tasua';
  if (month === 1 && day === 10) return 'ashura';
  if (day >= 13 && day <= 15 && month !== 9 && month !== 12) return 'ayyam-bid';
  return null;
}
