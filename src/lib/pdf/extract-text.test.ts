import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { extractPdfText } from './extract-text';

async function makePdf(pageTexts: string[]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pageTexts) {
    const page = doc.addPage([600, 200]);
    page.drawText(text, { x: 10, y: 100, size: 10, font });
  }
  return Buffer.from(await doc.save());
}

describe('extractPdfText', () => {
  // Regression test: the truncation flag used to be derived from
  // `fullText.length > maxChars` *after* the per-page loop already broke
  // early — if a page boundary landed exactly at the cap, the flag came out
  // false even though later pages were silently dropped. Inject a small cap
  // that lands exactly on the first page's extracted length to make the
  // boundary deterministic instead of fighting PDF text-layout internals.
  it('reports truncated when the loop breaks exactly at a page boundary', async () => {
    const firstPageText = 'abcdefghij';
    const bytes = await makePdf([firstPageText, 'page two content']);

    const result = await extractPdfText(bytes, firstPageText.length);
    expect(result.truncated).toBe(true);
    expect(result.text).not.toContain('page two content');
  });

  it('does not report truncated when nothing was actually dropped', async () => {
    const bytes = await makePdf(['short document']);
    const result = await extractPdfText(bytes, 1000);
    expect(result.truncated).toBe(false);
    expect(result.text).toContain('short document');
  });

  it('truncates and flags a single page whose own text exceeds the cap', async () => {
    const bytes = await makePdf(['abcdefghijklmnop']);
    const result = await extractPdfText(bytes, 5);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe('abcde');
  });
});
