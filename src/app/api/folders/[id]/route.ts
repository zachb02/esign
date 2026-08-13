import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { wouldCreateCycle } from '@/lib/folders/cycle-guard';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const existing = await prisma.folder.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
  }

  const data: { name?: string; parentId?: string | null } = {};

  if (typeof body.name === 'string') {
    const trimmed = body.name.trim();
    if (!trimmed) {
      return NextResponse.json({ error: 'Folder name cannot be empty' }, { status: 400 });
    }
    data.name = trimmed;
  }

  if ('parentId' in body) {
    const newParentId: string | null = body.parentId;
    if (newParentId !== null) {
      const parent = await prisma.folder.findUnique({ where: { id: newParentId } });
      if (!parent) {
        return NextResponse.json({ error: 'Parent folder not found' }, { status: 404 });
      }
      const all = await prisma.folder.findMany({ select: { id: true, parentId: true } });
      if (wouldCreateCycle(all, id, newParentId)) {
        return NextResponse.json(
          { error: 'Cannot move a folder into its own descendant' },
          { status: 400 }
        );
      }
    }
    data.parentId = newParentId;
  }

  const updated = await prisma.folder.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await prisma.folder.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.document.updateMany({
      where: { folderId: id },
      data: { folderId: existing.parentId },
    }),
    prisma.folder.updateMany({
      where: { parentId: id },
      data: { parentId: existing.parentId },
    }),
    prisma.folder.delete({ where: { id } }),
  ]);

  return NextResponse.json({ success: true });
}
