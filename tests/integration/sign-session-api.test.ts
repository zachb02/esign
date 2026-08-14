import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import * as sessionRoute from '@/app/api/sign/[token]/route';

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
