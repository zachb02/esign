import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import * as sessionRoute from '@/app/api/sign/[token]/route';
import * as fieldValueRoute from '@/app/api/sign/[token]/fields/[fieldId]/route';
import * as completeRoute from '@/app/api/sign/[token]/complete/route';
import { getDocumentStorage } from '@/lib/storage';
import { makeTestPdf } from '../fixtures/make-test-pdf';

beforeEach(async () => {
  await prisma.fieldValue.deleteMany();
  await prisma.recipient.deleteMany();
  await prisma.field.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
});

afterAll(async () => {
  await prisma.fieldValue.deleteMany();
  await prisma.recipient.deleteMany();
  await prisma.field.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
  await prisma.$disconnect();
});

async function createSentDocumentWithRecipient() {
  const document = await prisma.document.create({
    data: {
      title: 'Contract',
      originalFilename: 'c.pdf',
      fileHash: 'h',
      storageKey: 'h.pdf',
      pageCount: 1,
      fileSizeBytes: 10,
      status: 'SENT',
    },
  });
  const role = await prisma.signerRole.create({
    data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
  });
  const field = await prisma.field.create({
    data: {
      documentId: document.id,
      signerRoleId: role.id,
      type: 'SIGNATURE',
      page: 1,
      x: 0.1,
      y: 0.1,
      width: 0.25,
      height: 0.06,
    },
  });
  const recipient = await prisma.recipient.create({
    data: {
      documentId: document.id,
      signerRoleId: role.id,
      name: 'Jane Doe',
      email: 'jane@example.com',
      signingToken: 'test-token-123',
    },
  });
  return { document, role, field, recipient };
}

describe('GET /api/sign/:token', () => {
  it('returns the recipient, document, and their fields for a valid token', async () => {
    const { field } = await createSentDocumentWithRecipient();
    const request = new NextRequest('http://localhost/api/sign/test-token-123');
    const response = await sessionRoute.GET(request, {
      params: Promise.resolve({ token: 'test-token-123' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recipient.name).toBe('Jane Doe');
    expect(body.recipient.status).toBe('PENDING');
    expect(body.document.title).toBe('Contract');
    expect(body.fields).toHaveLength(1);
    expect(body.fields[0].id).toBe(field.id);
    expect(body.fields[0].value).toBeNull();
  });

  it('returns 404 for an unknown token', async () => {
    const request = new NextRequest('http://localhost/api/sign/does-not-exist');
    const response = await sessionRoute.GET(request, {
      params: Promise.resolve({ token: 'does-not-exist' }),
    });
    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/sign/:token/fields/:fieldId', () => {
  it('saves a TEXT value via JSON', async () => {
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h4',
        storageKey: 'h4.pdf',
        pageCount: 1,
        fileSizeBytes: 10,
        status: 'SENT',
      },
    });
    const role = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    const field = await prisma.field.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        type: 'TEXT',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.04,
      },
    });
    const recipient = await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'Jane',
        email: 'jane@example.com',
        signingToken: 'text-token',
      },
    });

    const request = new NextRequest(`http://localhost/api/sign/text-token/fields/${field.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textValue: 'Jane Doe' }),
    });
    const response = await fieldValueRoute.PATCH(request, {
      params: Promise.resolve({ token: 'text-token', fieldId: field.id }),
    });
    expect(response.status).toBe(200);
    const value = await prisma.fieldValue.findUnique({ where: { fieldId: field.id } });
    expect(value?.textValue).toBe('Jane Doe');
    expect(value?.recipientId).toBe(recipient.id);
  });

  it('saves a signature image via multipart upload', async () => {
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h5',
        storageKey: 'h5.pdf',
        pageCount: 1,
        fileSizeBytes: 10,
        status: 'SENT',
      },
    });
    const role = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    const field = await prisma.field.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        type: 'SIGNATURE',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.25,
        height: 0.06,
      },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'Jane',
        email: 'jane@example.com',
        signingToken: 'sig-token',
      },
    });

    const formData = new FormData();
    formData.append('image', new File([Buffer.from([1, 2, 3, 4])], 'sig.png', { type: 'image/png' }));
    const request = new NextRequest(`http://localhost/api/sign/sig-token/fields/${field.id}`, {
      method: 'PATCH',
      body: formData,
    });
    const response = await fieldValueRoute.PATCH(request, {
      params: Promise.resolve({ token: 'sig-token', fieldId: field.id }),
    });
    expect(response.status).toBe(200);
    const value = await prisma.fieldValue.findUnique({ where: { fieldId: field.id } });
    expect(value?.signatureImageKey).toMatch(/\.png$/);
  });

  it('rejects a field-value update for an unknown token', async () => {
    const request = new NextRequest('http://localhost/api/sign/nope/fields/whatever', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textValue: 'x' }),
    });
    const response = await fieldValueRoute.PATCH(request, {
      params: Promise.resolve({ token: 'nope', fieldId: 'whatever' }),
    });
    expect(response.status).toBe(404);
  });
});

describe('POST /api/sign/:token/complete', () => {
  it('rejects completion when a required field is missing a value', async () => {
    const pdfBytes = await makeTestPdf(1);
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h6',
        storageKey: 'h6.pdf',
        pageCount: 1,
        fileSizeBytes: pdfBytes.byteLength,
        status: 'SENT',
      },
    });
    await getDocumentStorage().save('h6.pdf', pdfBytes);
    const role = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    await prisma.field.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        type: 'TEXT',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.04,
        required: true,
      },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'Jane',
        email: 'jane@example.com',
        signingToken: 'incomplete-token',
      },
    });

    const request = new NextRequest('http://localhost/api/sign/incomplete-token/complete', {
      method: 'POST',
    });
    const response = await completeRoute.POST(request, {
      params: Promise.resolve({ token: 'incomplete-token' }),
    });
    expect(response.status).toBe(400);
  });

  it('completes a single-recipient document, flattens the PDF, and marks it COMPLETED', async () => {
    const pdfBytes = await makeTestPdf(1);
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h7',
        storageKey: 'h7.pdf',
        pageCount: 1,
        fileSizeBytes: pdfBytes.byteLength,
        status: 'SENT',
      },
    });
    await getDocumentStorage().save('h7.pdf', pdfBytes);
    const role = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    const field = await prisma.field.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        type: 'TEXT',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.04,
        required: true,
      },
    });
    const recipient = await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'Jane',
        email: 'jane@example.com',
        signingToken: 'complete-token',
      },
    });
    await prisma.fieldValue.create({
      data: { fieldId: field.id, recipientId: recipient.id, textValue: 'Jane Doe' },
    });

    const request = new NextRequest('http://localhost/api/sign/complete-token/complete', {
      method: 'POST',
    });
    const response = await completeRoute.POST(request, {
      params: Promise.resolve({ token: 'complete-token' }),
    });
    expect(response.status).toBe(200);

    const reloadedRecipient = await prisma.recipient.findUnique({ where: { id: recipient.id } });
    expect(reloadedRecipient?.status).toBe('SIGNED');
    expect(reloadedRecipient?.signedAt).not.toBeNull();

    const reloadedDocument = await prisma.document.findUnique({ where: { id: document.id } });
    expect(reloadedDocument?.status).toBe('COMPLETED');
    expect(reloadedDocument?.completedPdfKey).not.toBeNull();

    const flattenedBytes = await getDocumentStorage().read(reloadedDocument!.completedPdfKey!);
    expect(flattenedBytes.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('sets status to IN_PROGRESS when one of two recipients completes', async () => {
    const pdfBytes = await makeTestPdf(1);
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h8',
        storageKey: 'h8.pdf',
        pageCount: 1,
        fileSizeBytes: pdfBytes.byteLength,
        status: 'SENT',
      },
    });
    await getDocumentStorage().save('h8.pdf', pdfBytes);
    const roleA = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    const roleB = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 2', order: 1, colorIndex: 1 },
    });
    await prisma.field.create({
      data: {
        documentId: document.id,
        signerRoleId: roleA.id,
        type: 'CHECKBOX',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.03,
        height: 0.03,
        required: false,
      },
    });
    await prisma.field.create({
      data: {
        documentId: document.id,
        signerRoleId: roleB.id,
        type: 'CHECKBOX',
        page: 1,
        x: 0.2,
        y: 0.2,
        width: 0.03,
        height: 0.03,
        required: false,
      },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: roleA.id,
        name: 'A',
        email: 'a@example.com',
        signingToken: 'two-recipients-a',
      },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: roleB.id,
        name: 'B',
        email: 'b@example.com',
        signingToken: 'two-recipients-b',
      },
    });

    const request = new NextRequest('http://localhost/api/sign/two-recipients-a/complete', {
      method: 'POST',
    });
    const response = await completeRoute.POST(request, {
      params: Promise.resolve({ token: 'two-recipients-a' }),
    });
    expect(response.status).toBe(200);

    const reloadedDocument = await prisma.document.findUnique({ where: { id: document.id } });
    expect(reloadedDocument?.status).toBe('IN_PROGRESS');
  });

  it('auto-fills a DATE_SIGNED field on completion', async () => {
    const pdfBytes = await makeTestPdf(1);
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h9',
        storageKey: 'h9.pdf',
        pageCount: 1,
        fileSizeBytes: pdfBytes.byteLength,
        status: 'SENT',
      },
    });
    await getDocumentStorage().save('h9.pdf', pdfBytes);
    const role = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    const dateField = await prisma.field.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        type: 'DATE_SIGNED',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.15,
        height: 0.04,
        required: true,
      },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'Jane',
        email: 'jane@example.com',
        signingToken: 'date-token',
      },
    });

    const request = new NextRequest('http://localhost/api/sign/date-token/complete', {
      method: 'POST',
    });
    const response = await completeRoute.POST(request, {
      params: Promise.resolve({ token: 'date-token' }),
    });
    expect(response.status).toBe(200);

    const value = await prisma.fieldValue.findUnique({ where: { fieldId: dateField.id } });
    expect(value?.dateValue).not.toBeNull();
  });
});
