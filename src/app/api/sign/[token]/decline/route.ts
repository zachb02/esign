import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json().catch(() => ({}));

  const recipient = await prisma.recipient.findUnique({ where: { signingToken: token } });
  if (!recipient) {
    return NextResponse.json({ error: 'Signing link not found' }, { status: 404 });
  }
  if (recipient.status !== 'PENDING') {
    return NextResponse.json(
      { error: 'This signing session is already finished' },
      { status: 400 }
    );
  }

  const document = await prisma.document.findUnique({ where: { id: recipient.documentId } });
  if (document?.status === 'DECLINED') {
    return NextResponse.json(
      { error: 'This document was already declined by another signer' },
      { status: 400 }
    );
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() || null : null;
  const now = new Date();

  await prisma.$transaction([
    prisma.recipient.update({
      where: { id: recipient.id },
      data: { status: 'DECLINED', declinedAt: now, declineReason: reason },
    }),
    prisma.document.update({
      where: { id: recipient.documentId },
      data: { status: 'DECLINED' },
    }),
  ]);

  return NextResponse.json({ success: true });
}
