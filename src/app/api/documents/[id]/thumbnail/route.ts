import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getThumbnailStorage } from '@/lib/storage';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document || !document.thumbnailKey) {
    return NextResponse.json({ error: 'Thumbnail not available' }, { status: 404 });
  }
  const bytes = await getThumbnailStorage().read(document.thumbnailKey);
  return new NextResponse(bytes, { headers: { 'Content-Type': 'image/png' } });
}
