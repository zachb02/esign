import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import * as sessionRoute from '@/app/api/sign/[token]/route';
import * as fieldValueRoute from '@/app/api/sign/[token]/fields/[fieldId]/route';

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
