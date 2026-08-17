import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getDocumentStorage } from '@/lib/storage';
import { extractPdfText } from '@/lib/pdf/extract-text';
import { summarizeText, AiNotConfiguredError } from '@/lib/ai/summarize';

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const recipient = await prisma.recipient.findUnique({
    where: { signingToken: token },
    include: { document: true },
  });
  if (!recipient) {
    return NextResponse.json({ error: 'Signing link not found' }, { status: 404 });
  }

  try {
    const pdfBytes = await getDocumentStorage().read(
      recipient.document.completedPdfKey ?? recipient.document.storageKey
    );
    const { text, truncated } = await extractPdfText(pdfBytes);
    const summary = await summarizeText(text);
    return NextResponse.json({ summary, truncated });
  } catch (error) {
    if (error instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error(`Failed to summarize document ${recipient.documentId}`, error);
    return NextResponse.json({ error: 'Failed to generate a summary' }, { status: 502 });
  }
}
