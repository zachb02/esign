import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { generateSigningToken } from '@/lib/recipients/token';

interface Assignment {
  signerRoleId: string;
  name: string;
  email: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const document = await prisma.document.findUnique({
    where: { id },
    include: { signerRoles: true, fields: true },
  });
  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }
  if (document.status !== 'DRAFT') {
    return NextResponse.json({ error: 'This document has already been sent' }, { status: 400 });
  }
  if (document.fields.length === 0) {
    return NextResponse.json(
      { error: 'Add at least one field before sending this document' },
      { status: 400 }
    );
  }

  const assignments: Assignment[] = Array.isArray(body.assignments) ? body.assignments : [];
  const assignmentByRoleId = new Map(assignments.map((a) => [a.signerRoleId, a]));

  for (const role of document.signerRoles) {
    const assignment = assignmentByRoleId.get(role.id);
    if (
      !assignment ||
      typeof assignment.name !== 'string' ||
      !assignment.name.trim() ||
      typeof assignment.email !== 'string' ||
      !assignment.email.trim()
    ) {
      return NextResponse.json(
        { error: `Missing name/email assignment for signer role "${role.name}"` },
        { status: 400 }
      );
    }
  }

  const recipients = await prisma.$transaction(async (tx) => {
    const created = [];
    for (const role of document.signerRoles) {
      const assignment = assignmentByRoleId.get(role.id)!;
      const recipient = await tx.recipient.create({
        data: {
          documentId: document.id,
          signerRoleId: role.id,
          name: assignment.name.trim(),
          email: assignment.email.trim(),
          signingToken: generateSigningToken(),
        },
      });
      created.push(recipient);
    }
    await tx.document.update({ where: { id: document.id }, data: { status: 'SENT' } });
    return created;
  });

  return NextResponse.json({ recipients }, { status: 201 });
}
