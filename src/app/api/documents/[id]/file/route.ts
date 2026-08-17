import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getDocumentStorage } from '@/lib/storage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }
  const bytes = await getDocumentStorage().read(document.completedPdfKey ?? document.storageKey);
  // The HTML `download` attribute alone isn't reliably honored by every
  // browser against a server-sent `inline` disposition (Safari in
  // particular has a history of opening its native PDF viewer instead of
  // saving) — an explicit `?download=1` forces a real `attachment`
  // disposition that every browser respects, no client-side guesswork.
  const forceDownload = request.nextUrl.searchParams.get('download') === '1';
  const disposition = forceDownload ? 'attachment' : 'inline';
  // Defense-in-depth: strip CR/LF from the filename before it reaches the
  // header, same reasoning as the CRLF-injection fix on the send route —
  // this value is user-supplied (the uploaded file's original name).
  const safeFilename = document.originalFilename.replace(/[\r\n]/g, '');
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${safeFilename}"`,
    },
  });
}
