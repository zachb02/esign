import { describe, expect, it } from 'vitest';
import { getPdfPageCount, renderPdfPageToPng } from './render';
import { makeTestPdf } from '../../../tests/fixtures/make-test-pdf';

describe('PDF rendering', () => {
  it('counts pages correctly for a single-page PDF', async () => {
    const pdf = await makeTestPdf(1);
    expect(await getPdfPageCount(pdf)).toBe(1);
  });

  it('counts pages correctly for a multi-page PDF', async () => {
    const pdf = await makeTestPdf(5);
    expect(await getPdfPageCount(pdf)).toBe(5);
  });

  it('renders page 1 to a non-empty PNG buffer', async () => {
    const pdf = await makeTestPdf(2);
    const png = await renderPdfPageToPng(pdf, 1);
    expect(png.length).toBeGreaterThan(0);
    // PNG magic bytes
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('renders standard-font text (not just vector graphics) into the PNG', async () => {
    // Regression test: pdfjs-dist needs `standardFontDataUrl` to source glyph
    // outlines for non-embedded standard-14 fonts (e.g. pdf-lib's
    // StandardFonts.Helvetica) when `disableFontFace: true` is set for
    // server-side rendering. Without it, glyphs are silently dropped and the
    // page renders blank except for any vector graphics, which compresses to
    // a much smaller PNG. A blank 200x200 white page encodes to well under
    // 1KB, so a healthy size margin above that reliably distinguishes
    // "glyphs rendered" from "silently blank".
    const blankPdf = await makeTestPdf(1);
    const textPdf = await makeTestPdf(1, { withText: true });

    const blankPng = await renderPdfPageToPng(blankPdf, 1);
    const textPng = await renderPdfPageToPng(textPdf, 1);

    expect(textPng.length).toBeGreaterThan(blankPng.length * 2);
  });
});
