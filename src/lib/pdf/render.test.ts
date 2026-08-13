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
});
