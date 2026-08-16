import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getDocumentStorage, getSignatureStorage } from '@/lib/storage';
import { sha256Hex } from '@/lib/pdf/hash';
import {
  flattenPdf,
  appendCertificate,
  type FlattenFieldInput,
  type CertificateRecipientInput,
} from '@/lib/pdf/flatten';
import { recordAuditEvent } from '@/lib/audit/record';
import { verifyAuditChain } from '@/lib/audit/verify';
import { getRequestIp, getRequestUserAgent } from '@/lib/audit/request-metadata';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const ipAddress = getRequestIp(request);
  const userAgent = getRequestUserAgent(request);

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

  try {
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
      await recordAuditEvent(tx, {
        documentId: recipient.documentId,
        recipientId: recipient.id,
        type: 'SIGNED',
        ipAddress,
        userAgent,
      });
    });
  } catch (error) {
    console.error(`Failed to record signing for recipient ${recipient.id}`, error);
    return NextResponse.json({ error: 'Failed to complete signing' }, { status: 500 });
  }

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
            try {
              signaturePng = await getSignatureStorage().read(field.value.signatureImageKey);
            } catch (error) {
              console.error(
                `Failed to read signature file ${field.value.signatureImageKey} for field ${field.id} during flatten, skipping`,
                error
              );
            }
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

        // Append a Certificate of Completion page summarizing every
        // recipient's signing event and the audit chain's integrity, before
        // this document is ever marked COMPLETED. verifyAuditChain() here
        // necessarily reflects the state just before this document's own
        // COMPLETED event is recorded below — that event can't describe
        // itself.
        const allRecipients = await prisma.recipient.findMany({
          where: { documentId: recipient.documentId },
          include: { signerRole: true },
        });
        const signingEvents = await prisma.auditEvent.findMany({
          where: { documentId: recipient.documentId, type: { in: ['SIGNED', 'DECLINED'] } },
        });
        const ipByRecipientId = new Map(
          signingEvents.map((event) => [event.recipientId, event.ipAddress])
        );
        const certificateRecipients: CertificateRecipientInput[] = allRecipients.map((r) => ({
          name: r.name,
          email: r.email,
          roleName: r.signerRole.name,
          status: r.status,
          signedAt: r.signedAt,
          declinedAt: r.declinedAt,
          ipAddress: ipByRecipientId.get(r.id) ?? null,
        }));
        const chain = await verifyAuditChain(recipient.documentId);
        const chainSummary = chain.verified
          ? 'verified, no tampering detected'
          : `WARNING - integrity check failed at event ${chain.brokenAtIndex}`;

        const certifiedBytes = await appendCertificate(flattenedBytes, {
          recipients: certificateRecipients,
          chainSummary,
        });

        const completedKey = `${sha256Hex(certifiedBytes)}-completed.pdf`;
        await getDocumentStorage().save(completedKey, certifiedBytes);

        // Only move the document into COMPLETED if it hasn't already been
        // finalized (declined or completed) by a concurrent request. If a
        // sibling's decline landed between our re-check above and now, this
        // is a no-op and the document correctly stays DECLINED — the
        // recipient's own SIGNED status (already committed) is unaffected.
        //
        // Explicit timeout: this transaction can wait on the per-document
        // audit lock if another request is mid-write; on timeout it throws
        // into the catch below and the document falls back to IN_PROGRESS
        // with no retry path — bounding the wait keeps that failure mode
        // rare without making it silent.
        const completedCount = await prisma.$transaction(
          async (tx) => {
            const result = await tx.document.updateMany({
              where: { id: recipient.documentId, status: { notIn: ['DECLINED', 'COMPLETED'] } },
              data: { status: 'COMPLETED', completedPdfKey: completedKey },
            });
            if (result.count > 0) {
              await recordAuditEvent(tx, { documentId: recipient.documentId, type: 'COMPLETED' });
            }
            return result.count;
          },
          { timeout: 10000 }
        );
        if (completedCount === 0) {
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
