import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { isWellFormedPngStructure, isPngFlattenable } from './flattenable';

function makeRealSignaturePng(): Buffer {
  const canvas = createCanvas(300, 120);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 300, 120);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(10, 90);
  for (let x = 10; x < 290; x += 5) {
    ctx.lineTo(x, 90 + Math.sin(x / 12) * 25);
  }
  ctx.stroke();
  return canvas.toBuffer('image/png');
}

describe('isWellFormedPngStructure', () => {
  const real = makeRealSignaturePng();

  it('accepts a genuinely complete PNG', () => {
    expect(isWellFormedPngStructure(real)).toBe(true);
  });

  it('rejects an empty buffer', () => {
    expect(isWellFormedPngStructure(Buffer.alloc(0))).toBe(false);
  });

  it('rejects a buffer that is too short to hold the PNG signature', () => {
    expect(isWellFormedPngStructure(Buffer.from([0x89, 0x50, 0x4e]))).toBe(false);
  });

  it('rejects bytes with the wrong magic number', () => {
    expect(isWellFormedPngStructure(Buffer.from('not a png at all, just text'))).toBe(false);
  });

  it('rejects a chunk stream whose first chunk is not IHDR', () => {
    // Valid signature, but the first "chunk" claims to be IDAT.
    const fake = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0, 0, 0, 0]), // length 0
      Buffer.from('IDAT'),
      Buffer.from([0, 0, 0, 0]), // fake CRC
    ]);
    expect(isWellFormedPngStructure(fake)).toBe(false);
  });

  it('rejects a buffer with trailing garbage after a complete IEND', () => {
    const withGarbage = Buffer.concat([real, Buffer.from([1, 2, 3, 4])]);
    expect(isWellFormedPngStructure(withGarbage)).toBe(false);
  });

  // Regression coverage for the exact re-reviewer-reproduced hang: pdf-lib's
  // bundled PNG inflate enters an infinite synchronous loop on a truncated
  // deflate stream. Every ratio below must be rejected structurally, fast,
  // with zero decompression attempted.
  for (const ratio of [0.95, 0.9, 0.75, 0.5, 0.25, 0.1]) {
    it(`rejects a PNG truncated to ${ratio * 100}% of its length, in well under 100ms`, () => {
      const truncated = real.subarray(0, Math.floor(real.length * ratio));
      const start = Date.now();
      const result = isWellFormedPngStructure(truncated);
      const elapsedMs = Date.now() - start;
      expect(result).toBe(false);
      expect(elapsedMs).toBeLessThan(100);
    });
  }
});

describe('isPngFlattenable', () => {
  it('returns true for a genuinely complete, embeddable PNG', async () => {
    const embeddable = await isPngFlattenable(makeRealSignaturePng());
    expect(embeddable).toBe(true);
  });

  it('returns false, WITHIN A BOUNDED TIME, for a structurally well-formed PNG whose IDAT body is corrupted (not truncated)', async () => {
    // This is NOT a truncation case (isWellFormedPngStructure would pass
    // it) — it's a structurally complete PNG with the compressed IDAT
    // bytes corrupted in place. This independently reproduced a >90s hang
    // against a bare (unguarded) embedPng() call, proving that structural
    // validation alone does not make the embedPng backstop safe: some
    // non-truncated corruption forms can *also* drive pdf-lib's bundled
    // PNG inflate into the same non-terminating loop as truncation does.
    // isPngFlattenable is hardened against this independently of
    // isWellFormedPngStructure by running the embed in a worker thread
    // that gets forcibly terminated on a wall-clock deadline — the only
    // mechanism that can interrupt a synchronous infinite loop in Node.
    const real = makeRealSignaturePng();
    const idatIndex = real.indexOf(Buffer.from('IDAT'));
    expect(idatIndex).toBeGreaterThan(0);
    const dataStart = idatIndex + 4;
    const corrupted = Buffer.from(real);
    for (let i = dataStart + 5; i < dataStart + 15 && i < corrupted.length; i++) {
      corrupted[i] = corrupted[i] ^ 0xff;
    }
    // Confirm this is genuinely the "structurally valid but corrupt body"
    // case, not an accidental truncation-shaped failure.
    expect(isWellFormedPngStructure(corrupted)).toBe(true);

    const start = Date.now();
    const embeddable = await isPngFlattenable(corrupted);
    const elapsedMs = Date.now() - start;
    expect(embeddable).toBe(false);
    // Must be bounded by the worker timeout (a few seconds), not hang
    // indefinitely. This assertion is the whole point of the test: before
    // the worker-timeout hardening, this exact input hung for 90+
    // seconds with no completion in manual verification.
    expect(elapsedMs).toBeLessThan(8000);
  }, 15000);
});
