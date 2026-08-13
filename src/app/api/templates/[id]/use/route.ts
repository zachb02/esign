import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = await prisma.template.findUnique({
    where: { id },
    include: { signerRoles: true, fields: true },
  });
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }
  if (template.signerRoles.length === 0) {
    return NextResponse.json(
      {
        error:
          'This template has no signer roles yet — add at least one field before using it',
      },
      { status: 400 }
    );
  }

  const document = await prisma.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: {
        title: template.title,
        folderId: null,
        originalFilename: template.originalFilename,
        fileHash: template.fileHash,
        storageKey: template.storageKey,
        thumbnailKey: template.thumbnailKey,
        pageCount: template.pageCount,
        fileSizeBytes: template.fileSizeBytes,
        status: 'DRAFT',
      },
    });

    const roleIdMap = new Map<string, string>();
    for (const role of template.signerRoles) {
      const newRole = await tx.signerRole.create({
        data: {
          documentId: doc.id,
          name: role.name,
          order: role.order,
          colorIndex: role.colorIndex,
        },
      });
      roleIdMap.set(role.id, newRole.id);
    }

    for (const field of template.fields) {
      const newSignerRoleId = roleIdMap.get(field.signerRoleId);
      if (!newSignerRoleId) continue;
      await tx.field.create({
        data: {
          documentId: doc.id,
          signerRoleId: newSignerRoleId,
          type: field.type,
          page: field.page,
          x: field.x,
          y: field.y,
          width: field.width,
          height: field.height,
          required: field.required,
          label: field.label,
        },
      });
    }

    return doc;
  });

  return NextResponse.json(document, { status: 201 });
}
