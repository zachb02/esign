import { describe, expect, it } from 'vitest';
import { isPdfBuffer, assertValidPdf, InvalidPdfError } from './validate';

describe('PDF validation', () => {
  it('accepts a buffer starting with the PDF magic bytes', () => {
    expect(isPdfBuffer(Buffer.from('%PDF-1.7\n...'))).toBe(true);
  });

  it('rejects a buffer without the PDF magic bytes', () => {
    expect(isPdfBuffer(Buffer.from('not a pdf'))).toBe(false);
  });

  it('rejects a buffer shorter than the magic bytes', () => {
    expect(isPdfBuffer(Buffer.from('%PD'))).toBe(false);
  });

  it('assertValidPdf throws InvalidPdfError for a non-PDF buffer', () => {
    expect(() => assertValidPdf(Buffer.from('nope'))).toThrow(InvalidPdfError);
  });

  it('assertValidPdf does not throw for a valid PDF buffer', () => {
    expect(() => assertValidPdf(Buffer.from('%PDF-1.4\n'))).not.toThrow();
  });
});
