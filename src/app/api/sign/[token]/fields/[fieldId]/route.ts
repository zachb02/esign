import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSignatureStorage } from '@/lib/storage';
import { sha256Hex } from '@/lib/pdf/hash';
import { isPngFlattenable, isTextFlattenable, isWellFormedPngStructure } from '@/lib/pdf/flattenable';
import { recordAuditEvent } from '@/lib/audit/record';
import { getRequestIp, getRequestUserAgent } from '@/lib/audit/request-metadata';

const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SIGNATURE_UPLOAD_BYTES = 2 * 1024 * 1024; // 2MB

function isPngBuffer(buffer: Buffer): boolean {
  return buffer.length >= PNG_MAGIC_BYTES.length && buffer.subarray(0, 8).equals(PNG_MAGIC_BYTES);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; fieldId: string }> }
) {
  const { token, fieldId } = await params;
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
  if (document?.status === 'DECLINED') {
    return NextResponse.json(
      { error: 'This document was declined by another signer' },
      { status: 400 }
    );
  }

  const field = await prisma.field.findFirst({
    where: { id: fieldId, documentId: recipient.documentId, signerRoleId: recipient.signerRoleId },
  });
  if (!field) {
    return NextResponse.json({ error: 'Field not found for this signer' }, { status: 404 });
  }

  const contentType = request.headers.get('content-type') ?? '';
  const data: { textValue?: string; checked?: boolean; signatureImageKey?: string } = {};

  if (contentType.includes('multipart/form-data')) {
    if (field.type !== 'SIGNATURE' && field.type !== 'INITIALS') {
      return NextResponse.json(
        { error: 'Only signature/initials fields accept an image upload' },
        { status: 400 }
      );
    }
    const formData = await request.formData();
    const file = formData.get('image');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'An image field is required' }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.byteLength > MAX_SIGNATURE_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'Image file is too large' }, { status: 400 });
    }
    if (!isPngBuffer(buffer)) {
      return NextResponse.json({ error: 'File is not a valid PNG image' }, { status: 400 });
    }
    // Structural check FIRST, before any decompression is attempted.
    // pdf-lib's bundled PNG inflate can hang in an unrecoverable
    // synchronous infinite loop on a truncated deflate stream — no
    // try/catch or timeout can interrupt it once entered (see
    // src/lib/pdf/flattenable.ts). Rejecting a structurally incomplete
    // chunk stream here, before embedPng() ever runs, closes that DoS
    // without needing to decompress anything.
    if (!isWellFormedPngStructure(buffer)) {
      return NextResponse.json({ error: 'File is not a valid PNG image' }, { status: 400 });
    }
    // The structural + magic-bytes checks above are cheap pre-filters; the
    // real gate is whether pdf-lib can actually embed it, since a
    // structurally well-formed PNG can still have a corrupt body (bad CRC,
    // bad compression, invalid pixel data) that would otherwise pass here
    // and only fail silently at flatten time (see src/lib/pdf/flattenable.ts).
    if (!(await isPngFlattenable(buffer))) {
      return NextResponse.json({ error: 'File is not a valid PNG image' }, { status: 400 });
    }
    const key = `${sha256Hex(buffer)}.png`;
    await getSignatureStorage().save(key, buffer);
    data.signatureImageKey = key;
  } else {
    const body = await request.json();
    if (field.type === 'TEXT') {
      if (typeof body.textValue !== 'string') {
        return NextResponse.json({ error: 'textValue is required' }, { status: 400 });
      }
      const trimmed = body.textValue.trim();
      // Validate against the actual pdf-lib draw call flattening will make,
      // not an approximation — see src/lib/pdf/flattenable.ts for why a
      // Latin-1 regex isn't equivalent to what the font can really encode.
      if (trimmed && !(await isTextFlattenable(trimmed))) {
        return NextResponse.json(
          { error: 'Please use only standard Latin characters (accents are fine)' },
          { status: 400 }
        );
      }
      if (!trimmed) {
        // Empty/whitespace-only value means "clear this field" rather than a
        // validation error — remove any existing FieldValue row so
        // required-field checks at complete-time correctly see it as unfilled.
        await prisma.$transaction(async (tx) => {
          await tx.fieldValue.deleteMany({ where: { fieldId: field.id } });
          await recordAuditEvent(tx, {
            documentId: recipient.documentId,
            recipientId: recipient.id,
            type: 'FIELD_FILLED',
            detail: `${field.label ?? field.type} (cleared)`,
            ipAddress,
            userAgent,
          });
        });
        return NextResponse.json({ fieldId: field.id, cleared: true });
      }
      data.textValue = trimmed;
    } else if (field.type === 'CHECKBOX') {
      if (typeof body.checked !== 'boolean') {
        return NextResponse.json({ error: 'checked must be a boolean' }, { status: 400 });
      }
      data.checked = body.checked;
    } else {
      return NextResponse.json(
        { error: 'This field type does not accept a JSON value' },
        { status: 400 }
      );
    }
  }

  const value = await prisma.$transaction(async (tx) => {
    const created = await tx.fieldValue.upsert({
      where: { fieldId: field.id },
      create: { fieldId: field.id, recipientId: recipient.id, ...data },
      update: data,
    });
    await recordAuditEvent(tx, {
      documentId: recipient.documentId,
      recipientId: recipient.id,
      type: 'FIELD_FILLED',
      detail: field.label ?? field.type,
      ipAddress,
      userAgent,
    });
    return created;
  });

  return NextResponse.json(value);
}
