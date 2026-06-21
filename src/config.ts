import 'dotenv/config';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalBigInt(raw: string | undefined): bigint | null {
  if (!raw) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/**
 * Derive a public https://t.me/ link from an "@username" or a t.me URL,
 * or null if there's none (a numeric "-100..." id has no public link
 * without an API call, so callers just omit the link). Exported for tests.
 */
export function channelUrlFrom(raw: string): string | null {
  const id = raw.trim();
  if (id.startsWith('@')) {
    const handle = id.slice(1);
    return /^[A-Za-z0-9_]{4,32}$/.test(handle) ? `https://t.me/${handle}` : null;
  }
  const m = id.match(/^https?:\/\/t\.me\/(.+)$/i) ?? id.match(/^t\.me\/(.+)$/i);
  return m ? `https://t.me/${m[1]}` : null;
}

// Where the bot keeps its two tiny JSON files (the message-id pointer and the
// card file_id cache). One knob on purpose: both files share a disk and a
// lifecycle, so to persist them you point this at one volume and both follow.
// Trailing slashes are trimmed so `./data` and `./data/` behave the same.
const dataDir = (process.env.DATA_DIR?.trim() || './data').replace(/\/+$/, '');

const channelChatId = requireEnv('CHANNEL_CHAT_ID').trim();
// Optional, cosmetic. Kept separate from CHANNEL_CHAT_ID so posting can
// use the stable numeric id while the /start link comes from here; falls
// back to deriving from an "@username" chat id.
const channelPublicUrl = process.env.CHANNEL_PUBLIC_URL?.trim();

export const config = Object.freeze({
  botToken: requireEnv('BOT_TOKEN'),
  // Numeric "-100..." id (survives a username rename) or "@channel".
  // Passed as-is to the Bot API; a t.me URL is NOT accepted here.
  channelChatId,
  // Public link for /start, or null if none is configured/derivable.
  channelUrl: channelUrlFrom(channelPublicUrl || channelChatId),
  // Optional. If unset, /admin_* commands authorise nobody.
  adminTelegramId: optionalBigInt(process.env.ADMIN_TELEGRAM_ID),
  // Timezone for every cron schedule. Defaults to UTC.
  timezone: process.env.TZ_NAME?.trim() || 'UTC',
  // Pointer file for the replace-on-next-fire cleanup (see lib/state.ts).
  stateFilePath: `${dataDir}/last-message-ids.json`,
  // Content-hash → file_id cache so card images upload once, then resend by
  // file_id (no re-upload, instant client render). See lib/fileCache.ts.
  fileIdCachePath: `${dataDir}/file-ids.json`,
  isDev: process.env.NODE_ENV !== 'production',
});
