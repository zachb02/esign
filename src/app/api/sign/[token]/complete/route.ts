import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getDocumentStorage, getSignatureStorage } from '@/lib/storage';
import { sha256Hex } from '@/lib/pdf/hash';
import { flattenPdf, type FlattenFieldInput } from '@/lib/pdf/flatten';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const recipient = await prisma.recipient.findUnique({ where: { signingToken: token } });
  if (!recipient) {
    return NextResponse.json({ error: 'Signing link not found' }, { status: 404 });
  }
  if (recipient.status !== 'PENDING') {
    return NextResponse.json(
      { error: 'This signing session is already finished' },
      { status: 400 }
    );
  }

  const document = await prisma.document.findUnique({ where: { id: recipient.documentId } });
  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }
  if (document.status === 'DECLINED') {
    return NextResponse.json(
      { error: 'This document was declined by another signer' },
      { status: 400 }
    );
  }

  const fields = await prisma.field.findMany({
    where: { documentId: recipient.documentId, signerRoleId: recipient.signerRoleId },
    include: { value: true },
  });

  const missingRequired = fields.filter(
    (f) => f.required && f.type !== 'DATE_SIGNED' && !f.value
  );
  if (missingRequired.length > 0) {
    return NextResponse.json(
      {
        error: 'Please fill in all required fields before completing',
        missingFieldIds: missingRequired.map((f) => f.id),
      },
      { status: 400 }
    );
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const field of fields) {
      if (field.type === 'DATE_SIGNED' && !field.value) {
        await tx.fieldValue.create({
          data: { fieldId: field.id, recipientId: recipient.id, dateValue: now },
        });
      }
    }
    await tx.recipient.update({
      where: { id: recipient.id },
      data: { status: 'SIGNED', signedAt: now },
    });
  });

  const remainingPending = await prisma.recipient.count({
    where: { documentId: recipient.documentId, status: 'PENDING' },
  });

  if (remainingPending === 0) {
    // A sibling recipient may have declined between this recipient's own
    // SIGNED update above and this check — re-fetch the current status so we
    // never flatten (and mark "completed") a document that was just declined.
    const currentDocument = await prisma.document.findUnique({
      where: { id: recipient.documentId },
      select: { status: true },
    });

    if (currentDocument?.status === 'DECLINED') {
      console.log(
        `Document ${recipient.documentId} was declined by a sibling recipient; skipping flatten`
      );
    } else {
      try {
        const allFields = await prisma.field.findMany({
          where: { documentId: recipient.documentId },
          include: { value: true },
        });

        const flattenInputs: FlattenFieldInput[] = [];
        for (const field of allFields) {
          let signaturePng: Buffer | null = null;
          if (field.value?.signatureImageKey) {
            signaturePng = await getSignatureStorage().read(field.value.signatureImageKey);
          }
          flattenInputs.push({
            type: field.type,
            page: field.page,
            x: field.x,
            y: field.y,
            width: field.width,
            height: field.height,
            textValue: field.value?.textValue ?? null,
            checked: field.value?.checked ?? null,
            signaturePng,
            dateValue: field.value?.dateValue ?? null,
          });
        }

        const originalBytes = await getDocumentStorage().read(document.storageKey);
        const flattenedBytes = await flattenPdf(originalBytes, flattenInputs);
        const completedKey = `${sha256Hex(flattenedBytes)}-completed.pdf`;
        await getDocumentStorage().save(completedKey, flattenedBytes);

        // Only move the document into COMPLETED if it hasn't already been
        // finalized (declined or completed) by a concurrent request. If a
        // sibling's decline landed between our re-check above and now, this
        // is a no-op and the document correctly stays DECLINED — the
        // recipient's own SIGNED status (already committed) is unaffected.
        const { count } = await prisma.document.updateMany({
          where: { id: recipient.documentId, status: { notIn: ['DECLINED', 'COMPLETED'] } },
          data: { status: 'COMPLETED', completedPdfKey: completedKey },
        });
        if (count === 0) {
          console.log(
            `Document ${recipient.documentId} was already finalized by a concurrent request; skipping COMPLETED status write`
          );
        }
      } catch (error) {
        console.error('PDF flattening failed after final recipient completed', error);
        const { count } = await prisma.document.updateMany({
          where: { id: recipient.documentId, status: { notIn: ['DECLINED', 'COMPLETED'] } },
          data: { status: 'IN_PROGRESS' },
        });
        if (count === 0) {
          console.log(
            `Document ${recipient.documentId} was already finalized by a concurrent request; skipping IN_PROGRESS status write`
          );
        }
      }
    }
  } else {
    const { count } = await prisma.document.updateMany({
      where: { id: recipient.documentId, status: { notIn: ['DECLINED', 'COMPLETED'] } },
      data: { status: 'IN_PROGRESS' },
    });
    if (count === 0) {
      console.log(
        `Document ${recipient.documentId} was already finalized by a concurrent request; skipping IN_PROGRESS status write`
      );
    }
  }

  return NextResponse.json({ success: true });
}
