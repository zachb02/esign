import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSignatureStorage } from '@/lib/storage';
import { sha256Hex } from '@/lib/pdf/hash';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; fieldId: string }> }
) {
  const { token, fieldId } = await params;

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
    const key = `${sha256Hex(buffer)}.png`;
    await getSignatureStorage().save(key, buffer);
    data.signatureImageKey = key;
  } else {
    const body = await request.json();
    if (field.type === 'TEXT') {
      if (typeof body.textValue !== 'string' || !body.textValue.trim()) {
        return NextResponse.json({ error: 'textValue is required' }, { status: 400 });
      }
      data.textValue = body.textValue.trim();
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

  const value = await prisma.fieldValue.upsert({
    where: { fieldId: field.id },
    create: { fieldId: field.id, recipientId: recipient.id, ...data },
    update: data,
  });

  return NextResponse.json(value);
}
