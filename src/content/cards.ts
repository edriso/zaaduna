import { config } from '../config';

/**
 * Day-alternating azkar card images (morning / evening / pre-sleep).
 *
 * Each azkar has two cards, variant 1 and variant 2. The variant alternates by
 * the civil date in config.timezone: variant 1 on even day-numbers, variant 2
 * on odd — so all three azkar on the SAME day share one variant, and
 * consecutive days alternate ("a day this, a day that"). Keyed off the tz
 * civil date (never the host clock / Date.getDay()), turned into a stable epoch
 * day-number whose parity flips each calendar day — same discipline as
 * isPollNight in content/poll.ts. Stateless, so it is restart-safe by
 * construction.
 *
 * The cards live in ./assets/cards (copied into the Docker image; see
 * Dockerfile). They are sent as a SILENT separate photo just before the azkar
 * text — Telegram's 1024-char photo caption can't hold the full azkar — and
 * replaced on the next fire, just like the text. See scheduler.ts#sendCard.
 */

export type CardVariant = 1 | 2;

/** The two card files for an azkar, by its file base name. */
export interface CardPair {
  first: string;
  second: string;
}

const CARDS_DIR = './assets/cards';

/** Build the { first, second } paths for an azkar card set (e.g. 'morning-azkar'). */
export function azkarCard(base: string): CardPair {
  return {
    first: `${CARDS_DIR}/${base}-1.png`,
    second: `${CARDS_DIR}/${base}-2.png`,
  };
}

/** Days since the Unix epoch for the civil date in `tz` — a stable integer
 *  that increments by exactly 1 per local calendar day. */
function dayNumberInTz(now: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)!.value);
  return Math.floor(Date.UTC(get('year'), get('month') - 1, get('day')) / 86_400_000);
}

/**
 * The card variant for a given day: variant 1 on even day-numbers, variant 2
 * on odd, so it flips each calendar day. Defaults to now + config.timezone (the
 * scheduler calls it with no args); the args exist for tests. Flip the `=== 0`
 * to swap which parity is variant 1.
 */
export function cardVariantFor(now: Date = new Date(), tz: string = config.timezone): CardVariant {
  return dayNumberInTz(now, tz) % 2 === 0 ? 1 : 2;
}

/** Pick the card path for `now` from a { first, second } pair. */
export function cardFor(
  pair: CardPair,
  now: Date = new Date(),
  tz: string = config.timezone,
): string {
  return cardVariantFor(now, tz) === 1 ? pair.first : pair.second;
}
