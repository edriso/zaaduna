import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  initFileCache,
  getFileId,
  setFileId,
  dropFileId,
  hashFile,
  _resetForTests,
} from './fileCache';

/**
 * The card file_id cache: a tiny content-hash → file_id store so a card is
 * uploaded once and resent by file_id after. Mirrors the kit's state.ts
 * resilience: missing/corrupt file starts empty, never throws, and the bot
 * keeps working (it just re-uploads) without it.
 */

beforeEach(() => {
  _resetForTests();
});

describe('fileCache in-memory behaviour', () => {
  it('round-trips a file_id by content hash', async () => {
    expect(getFileId('abc')).toBeUndefined();
    await setFileId('abc', 'FILE_ID_1');
    expect(getFileId('abc')).toBe('FILE_ID_1');
  });

  it('drops a stale file_id', async () => {
    await setFileId('abc', 'FILE_ID_1');
    await dropFileId('abc');
    expect(getFileId('abc')).toBeUndefined();
  });

  it('dropping an unknown hash is a no-op', async () => {
    await dropFileId('missing'); // must not throw
    expect(getFileId('missing')).toBeUndefined();
  });
});

describe('hashFile', () => {
  it('hashes a real asset deterministically', async () => {
    const p = './assets/cards/morning-azkar-1.png';
    const a = await hashFile(p);
    const b = await hashFile(p);
    expect(a).toMatch(/^[0-9a-f]{40}$/); // sha1 hex
    expect(a).toBe(b);
  });

  it('two different cards hash differently', async () => {
    const a = await hashFile('./assets/cards/morning-azkar-1.png');
    const b = await hashFile('./assets/cards/morning-azkar-2.png');
    expect(a).not.toBe(b);
  });

  it('returns null for a missing file (caller then uploads without caching)', async () => {
    expect(await hashFile('./assets/cards/does-not-exist.png')).toBeNull();
  });
});

describe('fileCache disk persistence', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zaaduna-fc-'));
    file = path.join(dir, 'file-ids.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('persists across a reload', async () => {
    await initFileCache(file);
    await setFileId('h1', 'ID1');
    // A fresh load (e.g. after a restart) sees the persisted id.
    await initFileCache(file);
    expect(getFileId('h1')).toBe('ID1');
  });

  it('starts empty when the file does not exist', async () => {
    await initFileCache(path.join(dir, 'nope.json'));
    expect(getFileId('h1')).toBeUndefined();
  });

  it('starts empty (does not throw) on a corrupt file', async () => {
    await fs.writeFile(file, '{ not json', 'utf8');
    await initFileCache(file);
    expect(getFileId('h1')).toBeUndefined();
  });

  it('ignores non-string entries from a tampered file', async () => {
    await fs.writeFile(file, JSON.stringify({ good: 'ID', bad: 42, empty: '' }), 'utf8');
    await initFileCache(file);
    expect(getFileId('good')).toBe('ID');
    expect(getFileId('bad')).toBeUndefined();
    expect(getFileId('empty')).toBeUndefined();
  });
});
