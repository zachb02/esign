import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';

vi.mock('@/lib/email/send', () => ({
  isEmailConfigured: vi.fn(),
  sendSigningLinkEmail: vi.fn(),
}));

import { isEmailConfigured, sendSigningLinkEmail } from '@/lib/email/send';
import * as emailRoute from '@/app/api/documents/[id]/recipients/[recipientId]/email/route';

beforeEach(async () => {
  vi.mocked(isEmailConfigured).mockReset();
  vi.mocked(sendSigningLinkEmail).mockReset();
  await prisma.auditEvent.deleteMany();
  await prisma.recipient.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany();
  await prisma.recipient.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
  await prisma.$disconnect();
});

async function createSentDocumentWithRecipient() {
  const document = await prisma.document.create({
    data: {
      title: 'D',
      originalFilename: 'd.pdf',
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
  const recipient = await prisma.recipient.create({
    data: {
      documentId: document.id,
      signerRoleId: role.id,
      name: 'Jane Doe',
      email: 'jane@example.com',
      signingToken: 'tok-email-test',
    },
  });
  return { document, recipient };
}

function emailRequest(id: string, recipientId: string) {
  return new NextRequest(`http://localhost/api/documents/${id}/recipients/${recipientId}/email`, {
    method: 'POST',
  });
}

describe('POST /api/documents/:id/recipients/:recipientId/email', () => {
  it('returns 400 when SMTP is not configured', async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(false);
    const { document, recipient } = await createSentDocumentWithRecipient();
    const response = await emailRoute.POST(emailRequest(document.id, recipient.id), {
      params: Promise.resolve({ id: document.id, recipientId: recipient.id }),
    });
    expect(response.status).toBe(400);
    expect(sendSigningLinkEmail).not.toHaveBeenCalled();
  });

  it('sends the email and records an EMAIL_SENT audit event when configured', async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(true);
    vi.mocked(sendSigningLinkEmail).mockResolvedValue(undefined);
    const { document, recipient } = await createSentDocumentWithRecipient();
    const response = await emailRoute.POST(emailRequest(document.id, recipient.id), {
      params: Promise.resolve({ id: document.id, recipientId: recipient.id }),
    });
    expect(response.status).toBe(200);
    expect(sendSigningLinkEmail).toHaveBeenCalledWith(
      'jane@example.com',
      'Jane Doe',
      'D',
      expect.stringContaining(`/sign/${recipient.signingToken}`)
    );
    const event = await prisma.auditEvent.findFirst({
      where: { documentId: document.id, type: 'EMAIL_SENT' },
    });
    expect(event?.detail).toBe('jane@example.com');
  });

  it('returns 502 and does not record an audit event when sending fails', async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(true);
    vi.mocked(sendSigningLinkEmail).mockRejectedValue(new Error('SMTP connection refused'));
    const { document, recipient } = await createSentDocumentWithRecipient();
    const response = await emailRoute.POST(emailRequest(document.id, recipient.id), {
      params: Promise.resolve({ id: document.id, recipientId: recipient.id }),
    });
    expect(response.status).toBe(502);
    expect(
      await prisma.auditEvent.count({ where: { documentId: document.id, type: 'EMAIL_SENT' } })
    ).toBe(0);
  });

  it('returns 404 for a recipient that does not belong to the given document', async () => {
    vi.mocked(isEmailConfigured).mockReturnValue(true);
    const { recipient } = await createSentDocumentWithRecipient();
    const response = await emailRoute.POST(emailRequest('wrong-doc-id', recipient.id), {
      params: Promise.resolve({ id: 'wrong-doc-id', recipientId: recipient.id }),
    });
    expect(response.status).toBe(404);
  });
});
