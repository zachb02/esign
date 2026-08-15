import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { acquireDocumentAuditLock, recordAuditEvent } from '@/lib/audit/record';
import { getRequestIp, getRequestUserAgent } from '@/lib/audit/request-metadata';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const recipient = await prisma.recipient.findUnique({
    where: { signingToken: token },
    include: { document: true },
  });
  if (!recipient) {
    return NextResponse.json({ error: 'Signing link not found' }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await acquireDocumentAuditLock(tx, recipient.documentId);
    const alreadyViewed = await tx.auditEvent.findFirst({
      where: { documentId: recipient.documentId, recipientId: recipient.id, type: 'VIEWED' },
    });
    if (!alreadyViewed) {
      await recordAuditEvent(tx, {
        documentId: recipient.documentId,
        recipientId: recipient.id,
        type: 'VIEWED',
        ipAddress: getRequestIp(request),
        userAgent: getRequestUserAgent(request),
      });
    }
  });

  const fields = await prisma.field.findMany({
    where: { documentId: recipient.documentId, signerRoleId: recipient.signerRoleId },
    orderBy: [{ page: 'asc' }, { createdAt: 'asc' }],
    include: { value: true },
  });

  return NextResponse.json({
    recipient: {
      id: recipient.id,
      name: recipient.name,
      status: recipient.status,
      declineReason: recipient.declineReason,
    },
    document: {
      id: recipient.document.id,
      title: recipient.document.title,
      pageCount: recipient.document.pageCount,
      status: recipient.document.status,
    },
    fields,
  });
}
