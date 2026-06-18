import { config } from '../config';

/**
 * Day-alternating azkar card images (morning / evening / pre-sleep).
 *
 * Each azkar has a light and a dark card. The theme alternates by the civil
 * date in config.timezone: light on even day-numbers, dark on odd — so all
 * three azkar on the SAME day share one theme, and consecutive days alternate
 * ("a day light, a day dark"). Keyed off the tz civil date (never the host
 * clock / Date.getDay()), turned into a stable epoch day-number whose parity
 * flips each calendar day — same discipline as isPollNight in content/poll.ts.
 * Stateless, so it is restart-safe by construction.
 *
 * The cards live in ./assets/cards (copied into the Docker image; see
 * Dockerfile). They are sent as a SILENT separate photo just before the azkar
 * text — Telegram's 1024-char photo caption can't hold the full azkar — and
 * replaced on the next fire, just like the text. See scheduler.ts#sendCard.
 */

export type CardTheme = 'light' | 'dark';

/** A light + dark card pair for an azkar, by its file base name. */
export interface CardPair {
  light: string;
  dark: string;
}

const CARDS_DIR = './assets/cards';

/** Build the { light, dark } paths for an azkar card set (e.g. 'morningAzkar'). */
export function azkarCard(base: string): CardPair {
  return {
    light: `${CARDS_DIR}/${base}-light-card.png`,
    dark: `${CARDS_DIR}/${base}-dark-card.png`,
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
 * The card theme for a given day: light on even day-numbers, dark on odd, so
 * it flips each calendar day. Defaults to now + config.timezone (the scheduler
 * calls it with no args); the args exist for tests. Flip the `=== 0` to swap
 * which parity is light.
 */
export function cardThemeFor(now: Date = new Date(), tz: string = config.timezone): CardTheme {
  return dayNumberInTz(now, tz) % 2 === 0 ? 'light' : 'dark';
}

/** Pick the card path for `now` from a { light, dark } pair. */
export function cardFor(
  pair: CardPair,
  now: Date = new Date(),
  tz: string = config.timezone,
): string {
  return cardThemeFor(now, tz) === 'light' ? pair.light : pair.dark;
}
