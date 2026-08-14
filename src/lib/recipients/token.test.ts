import { describe, expect, it } from 'vitest';
import { generateSigningToken } from './token';

describe('generateSigningToken', () => {
  it('generates a URL-safe token of reasonable length', () => {
    const token = generateSigningToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates a different token on every call', () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateSigningToken()));
    expect(tokens.size).toBe(20);
  });
});
