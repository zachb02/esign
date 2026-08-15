import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { isEmailConfigured, sendSigningLinkEmail } from '@/lib/email/send';
import { recordAuditEvent } from '@/lib/audit/record';
import { getRequestIp, getRequestUserAgent } from '@/lib/audit/request-metadata';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; recipientId: string }> }
) {
  const { id, recipientId } = await params;

  if (!isEmailConfigured()) {
    return NextResponse.json({ error: 'Email delivery is not configured' }, { status: 400 });
  }

  const recipient = await prisma.recipient.findFirst({
    where: { id: recipientId, documentId: id },
  });
  if (!recipient) {
    return NextResponse.json({ error: 'Recipient not found' }, { status: 404 });
  }

  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  const signingLink = `${request.nextUrl.origin}/sign/${recipient.signingToken}`;

  try {
    await sendSigningLinkEmail(recipient.email, recipient.name, document.title, signingLink);
  } catch (error) {
    console.error(`Failed to send signing link email to recipient ${recipient.id}`, error);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 502 });
  }

  await prisma.$transaction(async (tx) => {
    await recordAuditEvent(tx, {
      documentId: id,
      recipientId: recipient.id,
      type: 'EMAIL_SENT',
      detail: recipient.email,
      ipAddress: getRequestIp(request),
      userAgent: getRequestUserAgent(request),
    });
  });

  return NextResponse.json({ success: true });
}
