import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { getDocumentStorage } from '@/lib/storage';
import { makeTestPdf } from '../fixtures/make-test-pdf';
import * as summarizeRoute from '@/app/api/sign/[token]/summarize/route';

beforeEach(async () => {
  await prisma.appSettings.deleteMany();
  await prisma.recipient.deleteMany();
  await prisma.field.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
});

afterAll(async () => {
  await prisma.appSettings.deleteMany();
  await prisma.recipient.deleteMany();
  await prisma.field.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
  await prisma.$disconnect();
});

async function createSentDocumentWithRecipient(storageKey: string) {
  const pdfBytes = await makeTestPdf(1);
  await getDocumentStorage().save(storageKey, pdfBytes);
  const document = await prisma.document.create({
    data: {
      title: 'Contract',
      originalFilename: 'c.pdf',
      fileHash: storageKey,
      storageKey,
      pageCount: 1,
      fileSizeBytes: pdfBytes.byteLength,
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
      name: 'Jane Doe',
      email: 'jane@example.com',
      signingToken: `summarize-test-${storageKey}`,
    },
  });
  return { document, recipient };
}

describe('POST /api/sign/:token/summarize', () => {
  it('returns 404 for an unknown token', async () => {
    const response = await summarizeRoute.POST(new Request('http://localhost/x'), {
      params: Promise.resolve({ token: 'does-not-exist' }),
    });
    expect(response.status).toBe(404);
  });

  it('returns 400 with a clear error when no AI provider is configured', async () => {
    const { recipient } = await createSentDocumentWithRecipient('summarize-h1.pdf');
    const response = await summarizeRoute.POST(new Request('http://localhost/x'), {
      params: Promise.resolve({ token: recipient.signingToken }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/no ai provider is configured/i);
  });
});
