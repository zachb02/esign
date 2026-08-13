import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { PdfViewer } from '@/components/pdf-viewer';

export default async function DocumentViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) notFound();
  return <PdfViewer documentId={document.id} title={document.title} />;
}
