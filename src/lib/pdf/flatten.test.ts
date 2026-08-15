import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { flattenPdf } from './flatten';
import { makeTestPdf } from '../../../tests/fixtures/make-test-pdf';
import { appendCertificate } from './flatten';

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

  it('does not throw for a TEXT field with non-Latin characters, and still draws other fields', async () => {
    // Constructs a FlattenFieldInput with a Cyrillic textValue directly,
    // bypassing the route-level WinAnsi validation, to prove the per-field
    // try/catch in flattenPdf is an independent defense: a field that would
    // make pdf-lib's WinAnsi-encoded Helvetica font throw must be skipped,
    // not allowed to abort the whole flatten call.
    const original = await makeTestPdf(1);
    const flattened = await flattenPdf(original, [
      {
        type: 'TEXT',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.04,
        textValue: 'Привет',
        checked: null,
        signaturePng: null,
        dateValue: null,
      },
      {
        type: 'CHECKBOX',
        page: 1,
        x: 0.4,
        y: 0.4,
        width: 0.03,
        height: 0.03,
        textValue: null,
        checked: true,
        signaturePng: null,
        dateValue: null,
      },
    ]);
    expect(flattened.subarray(0, 5).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(flattened);
    expect(doc.getPageCount()).toBe(1);
  });

  it('does not throw for a SIGNATURE field with non-PNG bytes under a signaturePng buffer', async () => {
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
        signaturePng: Buffer.from('not a real png'),
        dateValue: null,
      },
    ]);
    expect(flattened.subarray(0, 5).toString()).toBe('%PDF-');
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

describe('appendCertificate', () => {
  it('appends exactly one page listing each recipient', async () => {
    const original = await makeTestPdf(1);
    const result = await appendCertificate(original, {
      recipients: [
        {
          name: 'Jane Doe',
          email: 'jane@example.com',
          roleName: 'Signer 1',
          status: 'SIGNED',
          signedAt: new Date('2026-01-01T00:00:00Z'),
          declinedAt: null,
          ipAddress: '127.0.0.1',
        },
      ],
      chainSummary: 'verified, no tampering detected',
    });
    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(2);
  });

  it('falls back to a redacted line instead of throwing when a recipient name is not flattenable', async () => {
    // Recipient name/email is free text collected at Send time with no
    // WinAnsi validation (unlike field values). This proves one bad
    // recipient can't abort the whole certificate page, which would abort
    // the whole completion transaction and permanently strand an
    // already-fully-signed document.
    const original = await makeTestPdf(1);
    const result = await appendCertificate(original, {
      recipients: [
        {
          name: '太郎',
          email: 'taro@example.com',
          roleName: 'Signer 1',
          status: 'SIGNED',
          signedAt: new Date('2026-01-01T00:00:00Z'),
          declinedAt: null,
          ipAddress: null,
        },
      ],
      chainSummary: 'verified, no tampering detected',
    });
    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(2);
  });

  it('lists multiple recipients on the same certificate page', async () => {
    const original = await makeTestPdf(2);
    const result = await appendCertificate(original, {
      recipients: [
        {
          name: 'A',
          email: 'a@example.com',
          roleName: 'Signer 1',
          status: 'SIGNED',
          signedAt: new Date(),
          declinedAt: null,
          ipAddress: '10.0.0.1',
        },
        {
          name: 'B',
          email: 'b@example.com',
          roleName: 'Signer 2',
          status: 'DECLINED',
          signedAt: null,
          declinedAt: new Date(),
          ipAddress: '10.0.0.2',
        },
      ],
      chainSummary: 'verified, no tampering detected',
    });
    const loaded = await PDFDocument.load(result);
    expect(loaded.getPageCount()).toBe(3);
  });
});
