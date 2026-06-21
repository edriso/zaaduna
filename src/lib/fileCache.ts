import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { logger } from 'telegram-broadcast-kit';

/**
 * Content-hash → Telegram file_id cache, so a card image is uploaded ONCE and
 * resent by its file_id ever after.
 *
 * Why this exists: sendPhoto(new InputFile(path)) re-uploads the bytes every
 * fire and Telegram mints a brand-new file_id each time. To a client a new
 * file_id is a file it has never seen, so it shows a loading spinner and
 * re-downloads — even though the bytes are byte-for-byte the same card it
 * showed two days ago (there are only 6 card files). Reusing the file_id
 * (passing the string instead of an InputFile) makes Telegram serve its own
 * cached copy with no upload, and clients render it instantly. A file_id stays
 * valid even after the message that carried it is deleted (it points at the
 * file object on Telegram's servers, not the message), so it is fully
 * compatible with the card's replace-on-next-fire.
 *
 * Keyed by a hash of the file BYTES, not the path: when the art is swapped
 * (replace the PNGs keeping their names — see content/cards.ts) the hash
 * changes, the lookup misses, and the new art is uploaded once and re-cached.
 * No manual cache-busting.
 *
 * Same shape and the same "tiny JSON pointer, not a database" weight as the
 * kit's state.ts (one small file, written atomically, never depended on for
 * correctness): lose it and each card just re-uploads once, then caches again.
 * file_ids are also bot-specific, so the file is per-bot like the token — never
 * shared or committed (it lives under the gitignored ./data dir).
 *
 * This is deliberately a zaaduna-local module, not a kit helper: among the
 * broadcast kit's consumers only zaaduna sends photos. It mirrors the
 * caller-owns-the-cache shape the subscriber bots (tilawah/ayah) already use,
 * so it is a clean lift into telegram-broadcast-kit if a second broadcast bot
 * ever needs media.
 */

let cache: Record<string, string> = {};
let filePath: string | null = null;
// Bumped per write so two persists racing on the same file never share a tmp
// path (which would let one rename clobber the other's half-written tmp).
let writeSeq = 0;

/**
 * Load the cache from disk. Call once at startup, before the scheduler (safe to
 * call again). Never throws — a missing/unreadable/corrupt file just means
 * "start empty"; the bot must keep posting (it just re-uploads cards) without
 * it. If never called the cache is in-memory only, which is what lets unit
 * tests run with no filesystem.
 */
export async function initFileCache(p: string): Promise<void> {
  filePath = p;
  cache = {};
  try {
    const raw = await fs.readFile(p, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string' && v.length > 0) cache[k] = v;
      }
    }
    logger.info('Loaded file-id cache', { path: p, cached: Object.keys(cache).length });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      logger.info('No file-id cache yet, starting empty', { path: p });
    } else {
      logger.warn('Could not read file-id cache, starting empty', {
        path: p,
        error: String(err),
      });
    }
  }
}

/** The cached file_id for this content hash, or undefined. */
export function getFileId(hash: string): string | undefined {
  return cache[hash];
}

/** Cache a file_id under its content hash and persist (best-effort). */
export async function setFileId(hash: string, fileId: string): Promise<void> {
  cache[hash] = fileId;
  await persist();
}

/** Forget a file_id (e.g. Telegram rejected it as stale) and persist. */
export async function dropFileId(hash: string): Promise<void> {
  if (!(hash in cache)) return;
  delete cache[hash];
  await persist();
}

/**
 * SHA-1 of a file's bytes, as hex, or null if it can't be read. SHA-1 is used
 * as a fast content fingerprint (not for security); the cards are small so
 * hashing per send is negligible, and reading fresh each time means a swapped
 * file is picked up without a restart.
 */
export async function hashFile(p: string): Promise<string | null> {
  try {
    const bytes = await fs.readFile(p);
    return createHash('sha1').update(bytes).digest('hex');
  } catch (err) {
    logger.warn('Could not hash file for id cache; will upload without caching', {
      path: p,
      error: String(err),
    });
    return null;
  }
}

/**
 * Write atomically (tmp file + rename) so a crash mid-write never leaves
 * half-written JSON. Best-effort: a write failure is logged, not thrown — only
 * the cross-restart guarantee degrades (the cache still works in-memory).
 */
async function persist(): Promise<void> {
  if (!filePath) return; // initFileCache was never called (e.g. tests).
  const target = filePath;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Unique tmp per write so concurrent persists can't clobber each other's
    // tmp before its rename. JSON.stringify snapshots the whole live cache, so
    // whichever rename lands last wins with a complete, consistent file.
    const tmp = `${target}.${process.pid}.${writeSeq++}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(cache, null, 2), 'utf8');
    await fs.rename(tmp, target);
  } catch (err) {
    logger.error('Failed to persist file-id cache', { path: target, error: String(err) });
  }
}

/** Reset module state. Tests only. */
export function _resetForTests(): void {
  cache = {};
  filePath = null;
}
