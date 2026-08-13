import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { pickReassignmentRole } from '@/lib/fields/role-reassignment';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await prisma.signerRole.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Signer role not found' }, { status: 404 });
  }

  const siblingWhere = existing.templateId
    ? { templateId: existing.templateId }
    : { documentId: existing.documentId };
  const siblings = await prisma.signerRole.findMany({ where: siblingWhere });

  const reassignTo = pickReassignmentRole(siblings, id);
  if (!reassignTo) {
    return NextResponse.json({ error: 'Cannot delete the last signer role' }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.field.updateMany({
      where: { signerRoleId: id },
      data: { signerRoleId: reassignTo.id },
    }),
    prisma.signerRole.delete({ where: { id } }),
  ]);

  return NextResponse.json({ success: true });
}
