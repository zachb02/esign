import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET(
  _request: NextRequest,
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
