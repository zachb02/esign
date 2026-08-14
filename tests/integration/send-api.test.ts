import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import * as sendRoute from '@/app/api/documents/[id]/send/route';

beforeEach(async () => {
  await prisma.recipient.deleteMany();
  await prisma.fieldValue.deleteMany();
  await prisma.field.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
});

afterAll(async () => {
  await prisma.recipient.deleteMany();
  await prisma.fieldValue.deleteMany();
  await prisma.field.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
  await prisma.$disconnect();
});

async function createDraftDocumentWithOneField() {
  const document = await prisma.document.create({
    data: {
      title: 'D',
      originalFilename: 'd.pdf',
      fileHash: 'h',
      storageKey: 'h.pdf',
      pageCount: 1,
      fileSizeBytes: 10,
      status: 'DRAFT',
    },
  });
  const role = await prisma.signerRole.create({
    data: { documentId: document.id, name: 'Signer 1', order: 0, colorIndex: 0 },
  });
  await prisma.field.create({
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
  return { document, role };
}

function sendRequest(documentId: string, assignments: unknown) {
  return new NextRequest(`http://localhost/api/documents/${documentId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assignments }),
  });
}

describe('send API', () => {
  it('creates a recipient per signer role and sets status to SENT', async () => {
    const { document, role } = await createDraftDocumentWithOneField();
    const request = sendRequest(document.id, [
      { signerRoleId: role.id, name: 'Jane Doe', email: 'jane@example.com' },
    ]);
    const response = await sendRoute.POST(request, { params: Promise.resolve({ id: document.id }) });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.recipients).toHaveLength(1);
    expect(body.recipients[0].signingToken).toMatch(/^[A-Za-z0-9_-]+$/);

    const reloaded = await prisma.document.findUnique({ where: { id: document.id } });
    expect(reloaded?.status).toBe('SENT');
  });

  it('rejects sending with a missing assignment for a signer role', async () => {
    const { document } = await createDraftDocumentWithOneField();
    const request = sendRequest(document.id, []);
    const response = await sendRoute.POST(request, { params: Promise.resolve({ id: document.id }) });
    expect(response.status).toBe(400);
    expect(await prisma.recipient.count()).toBe(0);
  });

  it('rejects sending a document with zero fields', async () => {
    const document = await prisma.document.create({
      data: {
        title: 'Empty',
        originalFilename: 'e.pdf',
        fileHash: 'h2',
        storageKey: 'h2.pdf',
        pageCount: 1,
        fileSizeBytes: 10,
        status: 'DRAFT',
      },
    });
    const request = sendRequest(document.id, []);
    const response = await sendRoute.POST(request, { params: Promise.resolve({ id: document.id }) });
    expect(response.status).toBe(400);
  });

  it('rejects sending a document that is not DRAFT', async () => {
    const { document, role } = await createDraftDocumentWithOneField();
    await prisma.document.update({ where: { id: document.id }, data: { status: 'SENT' } });
    const request = sendRequest(document.id, [
      { signerRoleId: role.id, name: 'Jane Doe', email: 'jane@example.com' },
    ]);
    const response = await sendRoute.POST(request, { params: Promise.resolve({ id: document.id }) });
    expect(response.status).toBe(400);
  });
});
