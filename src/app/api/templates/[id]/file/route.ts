import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getDocumentStorage } from '@/lib/storage';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = await prisma.template.findUnique({ where: { id } });
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  const bytes = await getDocumentStorage().read(template.storageKey);
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(template.originalFilename)}"`,
    },
  });
}
