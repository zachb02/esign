import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getDocumentStorage, getThumbnailStorage } from '@/lib/storage';
import { sha256Hex } from '@/lib/pdf/hash';
import { assertValidPdf, InvalidPdfError } from '@/lib/pdf/validate';
import { getPdfPageCount, renderPdfPageToPng } from '@/lib/pdf/render';

export async function GET(request: NextRequest) {
  const folderId = request.nextUrl.searchParams.get('folderId');
  const where =
    folderId === null ? {} : folderId === 'root' ? { folderId: null } : { folderId };
  const documents = await prisma.document.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
  });
  return NextResponse.json(documents);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'A file field is required' }, { status: 400 });
  }
  const folderIdField = formData.get('folderId');
  const folderId =
    typeof folderIdField === 'string' && folderIdField.length > 0 ? folderIdField : null;

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    assertValidPdf(buffer);
  } catch (error) {
    if (error instanceof InvalidPdfError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  if (folderId) {
    const folder = await prisma.folder.findUnique({ where: { id: folderId } });
    if (!folder) {
      return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
    }
  }

  const fileHash = sha256Hex(buffer);
  const storageKey = `${fileHash}.pdf`;

  let pageCount: number;
  try {
    pageCount = await getPdfPageCount(buffer);
  } catch (error) {
    console.error('PDF page count extraction failed', error);
    return NextResponse.json({ error: 'File is not a valid PDF' }, { status: 400 });
  }

  try {
    await getDocumentStorage().save(storageKey, buffer);
  } catch (error) {
    console.error('Failed to store uploaded file', error);
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

  const document = await prisma.document.create({
    data: {
      title: file.name.replace(/\.pdf$/i, ''),
      folderId,
      originalFilename: file.name,
      fileHash,
      storageKey,
      thumbnailKey,
      pageCount,
      fileSizeBytes: buffer.byteLength,
      status: 'DRAFT',
    },
  });

  return NextResponse.json(document, { status: 201 });
}
