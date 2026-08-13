import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function GET(request: NextRequest) {
  const ownerType = request.nextUrl.searchParams.get('ownerType');
  const ownerId = request.nextUrl.searchParams.get('ownerId');
  if ((ownerType !== 'template' && ownerType !== 'document') || !ownerId) {
    return NextResponse.json(
      { error: 'ownerType and ownerId query params are required' },
      { status: 400 }
    );
  }
  const roles = await prisma.signerRole.findMany({
    where: ownerType === 'template' ? { templateId: ownerId } : { documentId: ownerId },
    orderBy: { order: 'asc' },
  });
  return NextResponse.json(roles);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const ownerType = body.ownerType;
  const ownerId = typeof body.ownerId === 'string' ? body.ownerId : '';
  if (ownerType !== 'template' && ownerType !== 'document') {
    return NextResponse.json(
      { error: 'ownerType must be "template" or "document"' },
      { status: 400 }
    );
  }
  if (!ownerId) {
    return NextResponse.json({ error: 'ownerId is required' }, { status: 400 });
  }

  const owner =
    ownerType === 'template'
      ? await prisma.template.findUnique({ where: { id: ownerId } })
      : await prisma.document.findUnique({ where: { id: ownerId } });
  if (!owner) {
    return NextResponse.json({ error: `${ownerType} not found` }, { status: 404 });
  }

  const existingCount = await prisma.signerRole.count({
    where: ownerType === 'template' ? { templateId: ownerId } : { documentId: ownerId },
  });

  const name =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim()
      : `Signer ${existingCount + 1}`;

  const role = await prisma.signerRole.create({
    data: {
      templateId: ownerType === 'template' ? ownerId : null,
      documentId: ownerType === 'document' ? ownerId : null,
      name,
      order: existingCount,
      colorIndex: existingCount,
    },
  });

  return NextResponse.json(role, { status: 201 });
}
