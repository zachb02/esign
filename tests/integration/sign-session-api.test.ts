import { describe, expect, it, beforeEach, afterAll, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prisma } from '@/lib/db/prisma';
import * as sessionRoute from '@/app/api/sign/[token]/route';
import * as fieldValueRoute from '@/app/api/sign/[token]/fields/[fieldId]/route';
import * as completeRoute from '@/app/api/sign/[token]/complete/route';
import * as declineRoute from '@/app/api/sign/[token]/decline/route';
import { getDocumentStorage } from '@/lib/storage';
import { makeTestPdf } from '../fixtures/make-test-pdf';

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'esign-sign-session-test-'));
  process.env.ESIGN_DATA_DIR = dataDir;
});

beforeEach(async () => {
  await prisma.fieldValue.deleteMany();
  await prisma.recipient.deleteMany();
  await prisma.field.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
});

afterAll(async () => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.ESIGN_DATA_DIR;
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
    const pngBytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([1, 2, 3, 4]),
    ]);
    formData.append('image', new File([pngBytes], 'sig.png', { type: 'image/png' }));
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

  it('rejects a TEXT value containing non-Latin characters (e.g. Cyrillic)', async () => {
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h-nonlatin',
        storageKey: 'h-nonlatin.pdf',
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
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'Jane',
        email: 'jane@example.com',
        signingToken: 'nonlatin-token',
      },
    });

    const request = new NextRequest(`http://localhost/api/sign/nonlatin-token/fields/${field.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textValue: 'Привет' }),
    });
    const response = await fieldValueRoute.PATCH(request, {
      params: Promise.resolve({ token: 'nonlatin-token', fieldId: field.id }),
    });
    expect(response.status).toBe(400);
    const value = await prisma.fieldValue.findUnique({ where: { fieldId: field.id } });
    expect(value).toBeNull();
  });

  it('accepts a TEXT value with accented Latin characters', async () => {
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h-accent',
        storageKey: 'h-accent.pdf',
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
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'Jane',
        email: 'jane@example.com',
        signingToken: 'accent-token',
      },
    });

    const request = new NextRequest(`http://localhost/api/sign/accent-token/fields/${field.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textValue: 'José Núñez' }),
    });
    const response = await fieldValueRoute.PATCH(request, {
      params: Promise.resolve({ token: 'accent-token', fieldId: field.id }),
    });
    expect(response.status).toBe(200);
    const value = await prisma.fieldValue.findUnique({ where: { fieldId: field.id } });
    expect(value?.textValue).toBe('José Núñez');
  });

  it('clears a TEXT field (deletes the FieldValue row) when sent an empty/whitespace-only value', async () => {
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h-clear',
        storageKey: 'h-clear.pdf',
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
        required: true,
      },
    });
    const recipient = await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'Jane',
        email: 'jane@example.com',
        signingToken: 'clear-token',
      },
    });
    await prisma.fieldValue.create({
      data: { fieldId: field.id, recipientId: recipient.id, textValue: 'Old Value' },
    });

    const request = new NextRequest(`http://localhost/api/sign/clear-token/fields/${field.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textValue: '   ' }),
    });
    const response = await fieldValueRoute.PATCH(request, {
      params: Promise.resolve({ token: 'clear-token', fieldId: field.id }),
    });
    expect(response.status).toBe(200);
    const value2 = await prisma.fieldValue.findUnique({ where: { fieldId: field.id } });
    expect(value2).toBeNull();
  });

  it('rejects a signature upload whose bytes are not a valid PNG', async () => {
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h-badpng',
        storageKey: 'h-badpng.pdf',
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
        signingToken: 'badpng-token',
      },
    });

    const formData = new FormData();
    formData.append(
      'image',
      new File([Buffer.from('this is definitely not a png file')], 'sig.png', { type: 'image/png' })
    );
    const request = new NextRequest(`http://localhost/api/sign/badpng-token/fields/${field.id}`, {
      method: 'PATCH',
      body: formData,
    });
    const response = await fieldValueRoute.PATCH(request, {
      params: Promise.resolve({ token: 'badpng-token', fieldId: field.id }),
    });
    expect(response.status).toBe(400);
    const value = await prisma.fieldValue.findUnique({ where: { fieldId: field.id } });
    expect(value).toBeNull();
  });

  it('rejects a signature upload that exceeds the 2MB size cap', async () => {
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h-toobig',
        storageKey: 'h-toobig.pdf',
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
        signingToken: 'toobig-token',
      },
    });

    const oversized = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(2 * 1024 * 1024 + 1, 0),
    ]);
    const formData = new FormData();
    formData.append('image', new File([oversized], 'sig.png', { type: 'image/png' }));
    const request = new NextRequest(`http://localhost/api/sign/toobig-token/fields/${field.id}`, {
      method: 'PATCH',
      body: formData,
    });
    const response = await fieldValueRoute.PATCH(request, {
      params: Promise.resolve({ token: 'toobig-token', fieldId: field.id }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects a PATCH using recipient A\'s token against recipient B\'s field on the same document', async () => {
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h-crossrecip',
        storageKey: 'h-crossrecip.pdf',
        pageCount: 1,
        fileSizeBytes: 10,
        status: 'SENT',
      },
    });
    const roleA = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer A', order: 0, colorIndex: 0 },
    });
    const roleB = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer B', order: 1, colorIndex: 1 },
    });
    const fieldA = await prisma.field.create({
      data: {
        documentId: document.id,
        signerRoleId: roleA.id,
        type: 'TEXT',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.04,
      },
    });
    const fieldB = await prisma.field.create({
      data: {
        documentId: document.id,
        signerRoleId: roleB.id,
        type: 'TEXT',
        page: 1,
        x: 0.3,
        y: 0.3,
        width: 0.2,
        height: 0.04,
      },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: roleA.id,
        name: 'A',
        email: 'a@example.com',
        signingToken: 'crossrecip-a',
      },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: roleB.id,
        name: 'B',
        email: 'b@example.com',
        signingToken: 'crossrecip-b',
      },
    });

    // Sanity: A's token can patch A's own field.
    const ownRequest = new NextRequest(`http://localhost/api/sign/crossrecip-a/fields/${fieldA.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textValue: 'A signs here' }),
    });
    const ownResponse = await fieldValueRoute.PATCH(ownRequest, {
      params: Promise.resolve({ token: 'crossrecip-a', fieldId: fieldA.id }),
    });
    expect(ownResponse.status).toBe(200);

    // A's token must NOT be able to patch B's field.
    const crossRequest = new NextRequest(`http://localhost/api/sign/crossrecip-a/fields/${fieldB.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textValue: 'Should be rejected' }),
    });
    const crossResponse = await fieldValueRoute.PATCH(crossRequest, {
      params: Promise.resolve({ token: 'crossrecip-a', fieldId: fieldB.id }),
    });
    expect(crossResponse.status).toBe(404);
    const bValue = await prisma.fieldValue.findUnique({ where: { fieldId: fieldB.id } });
    expect(bValue).toBeNull();
  });

  it('rejects a PATCH using document 1\'s recipient token against a field on document 2', async () => {
    const document1 = await prisma.document.create({
      data: {
        title: 'D1',
        originalFilename: 'd1.pdf',
        fileHash: 'h-crossdoc-1',
        storageKey: 'h-crossdoc-1.pdf',
        pageCount: 1,
        fileSizeBytes: 10,
        status: 'SENT',
      },
    });
    const document2 = await prisma.document.create({
      data: {
        title: 'D2',
        originalFilename: 'd2.pdf',
        fileHash: 'h-crossdoc-2',
        storageKey: 'h-crossdoc-2.pdf',
        pageCount: 1,
        fileSizeBytes: 10,
        status: 'SENT',
      },
    });
    const role1 = await prisma.signerRole.create({
      data: { documentId: document1.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    const role2 = await prisma.signerRole.create({
      data: { documentId: document2.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    await prisma.field.create({
      data: {
        documentId: document1.id,
        signerRoleId: role1.id,
        type: 'TEXT',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.04,
      },
    });
    const field2 = await prisma.field.create({
      data: {
        documentId: document2.id,
        signerRoleId: role2.id,
        type: 'TEXT',
        page: 1,
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.04,
      },
    });
    await prisma.recipient.create({
      data: {
        documentId: document1.id,
        signerRoleId: role1.id,
        name: 'A',
        email: 'a@example.com',
        signingToken: 'crossdoc-1',
      },
    });
    await prisma.recipient.create({
      data: {
        documentId: document2.id,
        signerRoleId: role2.id,
        name: 'B',
        email: 'b@example.com',
        signingToken: 'crossdoc-2',
      },
    });

    const request = new NextRequest(`http://localhost/api/sign/crossdoc-1/fields/${field2.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textValue: 'Should be rejected' }),
    });
    const response = await fieldValueRoute.PATCH(request, {
      params: Promise.resolve({ token: 'crossdoc-1', fieldId: field2.id }),
    });
    expect(response.status).toBe(404);
    const value = await prisma.fieldValue.findUnique({ where: { fieldId: field2.id } });
    expect(value).toBeNull();
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

  it('preserves the SIGNED recipient and falls back to IN_PROGRESS when flattening the PDF throws', async () => {
    // Bytes that pass the magic-byte check but are not a real PDF, so
    // PDFDocument.load inside flattenPdf throws naturally (same pattern as
    // the corrupt-PDF test in documents-api.test.ts).
    const corruptPdf = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.from('this is not real pdf content, just garbage bytes after the magic header'),
    ]);
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h10',
        storageKey: 'h10.pdf',
        pageCount: 1,
        fileSizeBytes: corruptPdf.byteLength,
        status: 'SENT',
      },
    });
    await getDocumentStorage().save('h10.pdf', corruptPdf);
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
        signingToken: 'flatten-fail-token',
      },
    });
    await prisma.fieldValue.create({
      data: { fieldId: field.id, recipientId: recipient.id, textValue: 'Jane Doe' },
    });

    const request = new NextRequest('http://localhost/api/sign/flatten-fail-token/complete', {
      method: 'POST',
    });
    const response = await completeRoute.POST(request, {
      params: Promise.resolve({ token: 'flatten-fail-token' }),
    });
    expect(response.status).toBe(200);

    const reloadedRecipient = await prisma.recipient.findUnique({ where: { id: recipient.id } });
    expect(reloadedRecipient?.status).toBe('SIGNED');
    expect(reloadedRecipient?.signedAt).not.toBeNull();

    const reloadedDocument = await prisma.document.findUnique({ where: { id: document.id } });
    expect(reloadedDocument?.status).toBe('IN_PROGRESS');
    expect(reloadedDocument?.completedPdfKey).toBeNull();
  });
});

describe('POST /api/sign/:token/decline', () => {
  it('declines a recipient and sets the document to DECLINED', async () => {
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h10',
        storageKey: 'h10.pdf',
        pageCount: 1,
        fileSizeBytes: 10,
        status: 'SENT',
      },
    });
    const role = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    const recipient = await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'Jane',
        email: 'jane@example.com',
        signingToken: 'decline-token',
      },
    });

    const request = new NextRequest('http://localhost/api/sign/decline-token/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Terms have changed' }),
    });
    const response = await declineRoute.POST(request, {
      params: Promise.resolve({ token: 'decline-token' }),
    });
    expect(response.status).toBe(200);

    const reloadedRecipient = await prisma.recipient.findUnique({ where: { id: recipient.id } });
    expect(reloadedRecipient?.status).toBe('DECLINED');
    expect(reloadedRecipient?.declineReason).toBe('Terms have changed');

    const reloadedDocument = await prisma.document.findUnique({ where: { id: document.id } });
    expect(reloadedDocument?.status).toBe('DECLINED');
  });

  it('rejects declining an already-finished recipient', async () => {
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h11',
        storageKey: 'h11.pdf',
        pageCount: 1,
        fileSizeBytes: 10,
        status: 'SENT',
      },
    });
    const role = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'Jane',
        email: 'jane@example.com',
        signingToken: 'already-signed-token',
        status: 'SIGNED',
      },
    });

    const request = new NextRequest('http://localhost/api/sign/already-signed-token/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await declineRoute.POST(request, {
      params: Promise.resolve({ token: 'already-signed-token' }),
    });
    expect(response.status).toBe(400);
  });
});

describe('Document.status transition race guards', () => {
  it('does not flip the document back to COMPLETED when the last pending recipient completes after a sibling already declined', async () => {
    const pdfBytes = await makeTestPdf(1);
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h-race-1',
        storageKey: 'h-race-1.pdf',
        pageCount: 1,
        fileSizeBytes: pdfBytes.byteLength,
        status: 'SENT',
      },
    });
    await getDocumentStorage().save('h-race-1.pdf', pdfBytes);
    const roleA = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer A', order: 0, colorIndex: 0 },
    });
    const roleB = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer B', order: 1, colorIndex: 1 },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: roleA.id,
        name: 'A',
        email: 'a@example.com',
        signingToken: 'race-a',
      },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: roleB.id,
        name: 'B',
        email: 'b@example.com',
        signingToken: 'race-b',
      },
    });

    // B declines first — document goes DECLINED, A is now the only remaining
    // pending recipient.
    const declineRequest = new NextRequest('http://localhost/api/sign/race-b/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const declineResponse = await declineRoute.POST(declineRequest, {
      params: Promise.resolve({ token: 'race-b' }),
    });
    expect(declineResponse.status).toBe(200);

    // A then tries to complete. Whether blocked outright by the top-level
    // DECLINED guard or by the conditional status-write guard deeper in the
    // route, the document must never end up COMPLETED and no completed PDF
    // may be produced for a document a party explicitly declined.
    const completeRequest = new NextRequest('http://localhost/api/sign/race-a/complete', {
      method: 'POST',
    });
    await completeRoute.POST(completeRequest, { params: Promise.resolve({ token: 'race-a' }) });

    const reloadedDocument = await prisma.document.findUnique({ where: { id: document.id } });
    expect(reloadedDocument?.status).toBe('DECLINED');
    expect(reloadedDocument?.completedPdfKey).toBeNull();
  });

  it('does not let decline overwrite an already-COMPLETED document status, but still records the recipient\'s own DECLINED state', async () => {
    // Simulates the race window directly at the DB layer: the document has
    // already been finalized as COMPLETED by a concurrent request (e.g. a
    // sibling recipient's completion), but this recipient's own row is still
    // PENDING. This deterministically exercises the conditional
    // `updateMany` guard in decline/route.ts without needing true
    // concurrency, since the top-level guard in that route only rejects
    // when status is DECLINED, not COMPLETED.
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h-race-2',
        storageKey: 'h-race-2.pdf',
        pageCount: 1,
        fileSizeBytes: 10,
        status: 'COMPLETED',
        completedPdfKey: 'some-completed-key.pdf',
      },
    });
    const role = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
    });
    const recipient = await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: role.id,
        name: 'C',
        email: 'c@example.com',
        signingToken: 'race-completed-decline',
      },
    });

    const request = new NextRequest('http://localhost/api/sign/race-completed-decline/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const response = await declineRoute.POST(request, {
      params: Promise.resolve({ token: 'race-completed-decline' }),
    });
    expect(response.status).toBe(200);

    const reloadedRecipient = await prisma.recipient.findUnique({ where: { id: recipient.id } });
    expect(reloadedRecipient?.status).toBe('DECLINED');

    const reloadedDocument = await prisma.document.findUnique({ where: { id: document.id } });
    expect(reloadedDocument?.status).toBe('COMPLETED');
    expect(reloadedDocument?.completedPdfKey).toBe('some-completed-key.pdf');
  });

  it('does not let a non-last completion overwrite an already-COMPLETED document status with IN_PROGRESS', async () => {
    // Mirror case: the document was already finalized COMPLETED by a
    // concurrent request, but this recipient (one of several) still has a
    // PENDING row and is not the last one. Their own completion must not
    // regress the document's shared status back to IN_PROGRESS.
    const document = await prisma.document.create({
      data: {
        title: 'D',
        originalFilename: 'd.pdf',
        fileHash: 'h-race-3',
        storageKey: 'h-race-3.pdf',
        pageCount: 1,
        fileSizeBytes: 10,
        status: 'COMPLETED',
        completedPdfKey: 'some-other-completed-key.pdf',
      },
    });
    const roleA = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer A', order: 0, colorIndex: 0 },
    });
    const roleB = await prisma.signerRole.create({
      data: { documentId: document.id, name: 'Signer B', order: 1, colorIndex: 1 },
    });
    const recipientA = await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: roleA.id,
        name: 'A',
        email: 'a@example.com',
        signingToken: 'race-completed-complete-a',
      },
    });
    await prisma.recipient.create({
      data: {
        documentId: document.id,
        signerRoleId: roleB.id,
        name: 'B',
        email: 'b@example.com',
        signingToken: 'race-completed-complete-b',
      },
    });

    const request = new NextRequest('http://localhost/api/sign/race-completed-complete-a/complete', {
      method: 'POST',
    });
    const response = await completeRoute.POST(request, {
      params: Promise.resolve({ token: 'race-completed-complete-a' }),
    });
    expect(response.status).toBe(200);

    const reloadedRecipientA = await prisma.recipient.findUnique({ where: { id: recipientA.id } });
    expect(reloadedRecipientA?.status).toBe('SIGNED');

    const reloadedDocument = await prisma.document.findUnique({ where: { id: document.id } });
    expect(reloadedDocument?.status).toBe('COMPLETED');
    expect(reloadedDocument?.completedPdfKey).toBe('some-other-completed-key.pdf');
  });
});
