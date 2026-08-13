import { describe, expect, it } from 'vitest';
import { sha256Hex } from './hash';

describe('sha256Hex', () => {
  it('is deterministic for the same input', () => {
    const data = Buffer.from('hello world');
    expect(sha256Hex(data)).toBe(sha256Hex(Buffer.from('hello world')));
  });

  it('differs for different input', () => {
    expect(sha256Hex(Buffer.from('a'))).not.toBe(sha256Hex(Buffer.from('b')));
  });

  it('matches the known SHA-256 of an empty buffer', () => {
    expect(sha256Hex(Buffer.alloc(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});
