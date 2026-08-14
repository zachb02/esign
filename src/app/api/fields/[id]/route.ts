import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { clampFieldRect } from '@/lib/fields/clamp';
import { isDocumentEditable } from '@/lib/documents/lock';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const existing = await prisma.field.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Field not found' }, { status: 404 });
  }
  if (existing.documentId) {
    const document = await prisma.document.findUnique({ where: { id: existing.documentId } });
    if (document && !isDocumentEditable(document.status)) {
      return NextResponse.json({ error: 'This document can no longer be edited' }, { status: 400 });
    }
  }

  const data: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    signerRoleId?: string;
    required?: boolean;
    label?: string | null;
  } = {};

  const hasRectUpdate =
    typeof body.x === 'number' ||
    typeof body.y === 'number' ||
    typeof body.width === 'number' ||
    typeof body.height === 'number';

  if (hasRectUpdate) {
    const clamped = clampFieldRect({
      x: typeof body.x === 'number' ? body.x : existing.x,
      y: typeof body.y === 'number' ? body.y : existing.y,
      width: typeof body.width === 'number' ? body.width : existing.width,
      height: typeof body.height === 'number' ? body.height : existing.height,
    });
    data.x = clamped.x;
    data.y = clamped.y;
    data.width = clamped.width;
    data.height = clamped.height;
  }

  if (typeof body.signerRoleId === 'string') {
    const ownerWhere = existing.templateId
      ? { templateId: existing.templateId }
      : { documentId: existing.documentId };
    const role = await prisma.signerRole.findFirst({
      where: { id: body.signerRoleId, ...ownerWhere },
    });
    if (!role) {
      return NextResponse.json(
        { error: "signerRoleId does not belong to this field's owner" },
        { status: 400 }
      );
    }
    data.signerRoleId = body.signerRoleId;
  }

  if (typeof body.required === 'boolean') {
    data.required = body.required;
  }

  if ('label' in body) {
    data.label = typeof body.label === 'string' ? body.label : null;
  }

  const updated = await prisma.field.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await prisma.field.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Field not found' }, { status: 404 });
  }
  if (existing.documentId) {
    const document = await prisma.document.findUnique({ where: { id: existing.documentId } });
    if (document && !isDocumentEditable(document.status)) {
      return NextResponse.json({ error: 'This document can no longer be edited' }, { status: 400 });
    }
  }
  await prisma.field.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
