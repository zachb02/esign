import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getDocumentStorage, getThumbnailStorage } from '@/lib/storage';
import { sha256Hex } from '@/lib/pdf/hash';
import { assertValidPdf, InvalidPdfError } from '@/lib/pdf/validate';
import { getPdfPageCount, renderPdfPageToPng } from '@/lib/pdf/render';

export async function GET() {
  const templates = await prisma.template.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { signerRoles: true } } },
  });
  return NextResponse.json(templates);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'A file field is required' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let pageCount: number;
  try {
    assertValidPdf(buffer);
    pageCount = await getPdfPageCount(buffer);
  } catch (error) {
    if (error instanceof InvalidPdfError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'File is not a valid PDF' }, { status: 400 });
  }

  const fileHash = sha256Hex(buffer);
  const storageKey = `${fileHash}.pdf`;

  try {
    await getDocumentStorage().save(storageKey, buffer);
  } catch (error) {
    console.error('Failed to store uploaded template', error);
    return NextResponse.json({ error: 'Failed to store the uploaded file' }, { status: 500 });
  }

  let thumbnailKey: string | null = null;
  try {
    const thumbnailPng = await renderPdfPageToPng(buffer, 1);
    thumbnailKey = `${fileHash}.png`;
    await getThumbnailStorage().save(thumbnailKey, thumbnailPng);
  } catch (error) {
    console.error('Thumbnail generation failed', error);
    thumbnailKey = null;
  }

  const template = await prisma.template.create({
    data: {
      title: file.name.replace(/\.pdf$/i, ''),
      originalFilename: file.name,
      fileHash,
      storageKey,
      thumbnailKey,
      pageCount,
      fileSizeBytes: buffer.byteLength,
    },
  });

  return NextResponse.json(template, { status: 201 });
}
