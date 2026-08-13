import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalFsStorageAdapter } from './local-fs-storage-adapter';

describe('LocalFsStorageAdapter', () => {
  let root: string;
  let adapter: LocalFsStorageAdapter;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'esign-storage-'));
    adapter = new LocalFsStorageAdapter(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('round-trips a small file', async () => {
    await adapter.save('a.txt', Buffer.from('hello'));
    expect(await adapter.exists('a.txt')).toBe(true);
    expect((await adapter.read('a.txt')).toString()).toBe('hello');
  });

  it('round-trips a large file (5MB)', async () => {
    const large = Buffer.alloc(5 * 1024 * 1024, 7);
    await adapter.save('big.bin', large);
    const read = await adapter.read('big.bin');
    expect(read.equals(large)).toBe(true);
  });

  it('creates nested directories for keys with slashes', async () => {
    await adapter.save('sub/dir/file.txt', Buffer.from('x'));
    expect(await adapter.exists('sub/dir/file.txt')).toBe(true);
  });

  it('deletes a file', async () => {
    await adapter.save('gone.txt', Buffer.from('x'));
    await adapter.delete('gone.txt');
    expect(await adapter.exists('gone.txt')).toBe(false);
  });

  it('reports exists=false for a missing key', async () => {
    expect(await adapter.exists('missing.txt')).toBe(false);
  });

  it('rejects keys that escape the storage root', async () => {
    await expect(adapter.save('../escape.txt', Buffer.from('x'))).rejects.toThrow(
      'Invalid storage key'
    );
  });
});
