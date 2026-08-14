import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { flattenPdf } from './flatten';
import { makeTestPdf } from '../../../tests/fixtures/make-test-pdf';

function makeTestSignaturePng(): Buffer {
  const canvas = createCanvas(100, 40);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(10, 10, 80, 20);
  return canvas.toBuffer('image/png');
}

describe('flattenPdf', () => {
  it('preserves page count and produces a valid PDF with no fields', async () => {
    const original = await makeTestPdf(3);
    const flattened = await flattenPdf(original, []);
    expect(flattened.subarray(0, 5).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(flattened);
    expect(doc.getPageCount()).toBe(3);
  });

  it('grows the PDF when a signature image is embedded', async () => {
    const original = await makeTestPdf(1);
    const flattened = await flattenPdf(original, [
      {
        type: 'SIGNATURE',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.25,
        height: 0.06,
        textValue: null,
        checked: null,
        signaturePng: makeTestSignaturePng(),
        dateValue: null,
      },
    ]);
    expect(flattened.length).toBeGreaterThan(original.length);
  });

  it('grows the PDF when a TEXT field has a value', async () => {
    const original = await makeTestPdf(1);
    const flattened = await flattenPdf(original, [
      {
        type: 'TEXT',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.04,
        textValue: 'Jane Doe',
        checked: null,
        signaturePng: null,
        dateValue: null,
      },
    ]);
    expect(flattened.length).toBeGreaterThan(original.length);
  });

  it('draws a checkmark only when CHECKBOX is checked', async () => {
    const original = await makeTestPdf(1);
    const baseField = {
      type: 'CHECKBOX' as const,
      page: 1,
      x: 0.1,
      y: 0.1,
      width: 0.03,
      height: 0.03,
      textValue: null,
      signaturePng: null,
      dateValue: null,
    };
    const checked = await flattenPdf(original, [{ ...baseField, checked: true }]);
    const unchecked = await flattenPdf(original, [{ ...baseField, checked: false }]);
    expect(checked.length).toBeGreaterThan(unchecked.length);
  });

  it('draws the date string for a DATE_SIGNED field', async () => {
    const original = await makeTestPdf(1);
    const flattened = await flattenPdf(original, [
      {
        type: 'DATE_SIGNED',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.15,
        height: 0.04,
        textValue: null,
        checked: null,
        signaturePng: null,
        dateValue: new Date('2026-08-13T00:00:00Z'),
      },
    ]);
    expect(flattened.length).toBeGreaterThan(original.length);
  });

  it('skips a field pointing at a page beyond the document', async () => {
    const original = await makeTestPdf(1);
    await expect(
      flattenPdf(original, [
        {
          type: 'TEXT',
          page: 5,
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.04,
          textValue: 'Should be skipped',
          checked: null,
          signaturePng: null,
          dateValue: null,
        },
      ])
    ).resolves.toBeInstanceOf(Buffer);
  });
});
