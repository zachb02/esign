import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getThumbnailStorage } from '@/lib/storage';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = await prisma.template.findUnique({ where: { id } });
  if (!template || !template.thumbnailKey) {
    return NextResponse.json({ error: 'Thumbnail not available' }, { status: 404 });
  }
  const bytes = await getThumbnailStorage().read(template.thumbnailKey);
  return new NextResponse(bytes, { headers: { 'Content-Type': 'image/png' } });
}
