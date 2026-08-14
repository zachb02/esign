import { NextRequest, NextResponse } from 'next/server';
import type { FieldType } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clampFieldRect } from '@/lib/fields/clamp';
import { DEFAULT_FIELD_SIZE } from '@/lib/fields/field-defaults';
import { isDocumentEditable } from '@/lib/documents/lock';

const VALID_TYPES: FieldType[] = ['SIGNATURE', 'INITIALS', 'DATE_SIGNED', 'TEXT', 'CHECKBOX'];

export async function GET(request: NextRequest) {
  const ownerType = request.nextUrl.searchParams.get('ownerType');
  const ownerId = request.nextUrl.searchParams.get('ownerId');
  if ((ownerType !== 'template' && ownerType !== 'document') || !ownerId) {
    return NextResponse.json(
      { error: 'ownerType and ownerId query params are required' },
      { status: 400 }
    );
  }
  const fields = await prisma.field.findMany({
    where: ownerType === 'template' ? { templateId: ownerId } : { documentId: ownerId },
    orderBy: [{ page: 'asc' }, { createdAt: 'asc' }],
  });
  return NextResponse.json(fields);
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
  if (typeof body.type !== 'string' || !VALID_TYPES.includes(body.type as FieldType)) {
    return NextResponse.json({ error: 'Invalid field type' }, { status: 400 });
  }
  const type = body.type as FieldType;
  const page = Number.isInteger(body.page) && body.page >= 1 ? body.page : null;
  if (page === null) {
    return NextResponse.json({ error: 'page must be a positive integer' }, { status: 400 });
  }

  const owner =
    ownerType === 'template'
      ? await prisma.template.findUnique({ where: { id: ownerId } })
      : await prisma.document.findUnique({ where: { id: ownerId } });
  if (!owner) {
    return NextResponse.json({ error: `${ownerType} not found` }, { status: 404 });
  }
  if (ownerType === 'document' && !isDocumentEditable((owner as unknown as { status: string }).status)) {
    return NextResponse.json({ error: 'This document can no longer be edited' }, { status: 400 });
  }

  const ownerWhere = ownerType === 'template' ? { templateId: ownerId } : { documentId: ownerId };

  let signerRoleId = typeof body.signerRoleId === 'string' ? body.signerRoleId : null;
  if (signerRoleId) {
    const role = await prisma.signerRole.findFirst({ where: { id: signerRoleId, ...ownerWhere } });
    if (!role) {
      return NextResponse.json(
        { error: 'signerRoleId does not belong to this owner' },
        { status: 400 }
      );
    }
  } else {
    const existingRole = await prisma.signerRole.findFirst({
      where: ownerWhere,
      orderBy: { order: 'asc' },
    });
    if (existingRole) {
      signerRoleId = existingRole.id;
    } else {
      const created = await prisma.signerRole.create({
        data: {
          templateId: ownerType === 'template' ? ownerId : null,
          documentId: ownerType === 'document' ? ownerId : null,
          name: 'Signer 1',
          order: 0,
          colorIndex: 0,
        },
      });
      signerRoleId = created.id;
    }
  }

  const defaultSize = DEFAULT_FIELD_SIZE[type];
  const rawX = typeof body.x === 'number' ? body.x : 0.1;
  const rawY = typeof body.y === 'number' ? body.y : 0.1;
  const clamped = clampFieldRect({
    x: rawX,
    y: rawY,
    width: defaultSize.width,
    height: defaultSize.height,
  });

  const field = await prisma.field.create({
    data: {
      templateId: ownerType === 'template' ? ownerId : null,
      documentId: ownerType === 'document' ? ownerId : null,
      signerRoleId,
      type,
      page,
      x: clamped.x,
      y: clamped.y,
      width: clamped.width,
      height: clamped.height,
      required: true,
    },
  });

  return NextResponse.json(field, { status: 201 });
}
