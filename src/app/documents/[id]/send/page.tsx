import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { SendClient } from './send-client';

export default async function SendPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = await prisma.document.findUnique({
    where: { id },
    include: { signerRoles: { orderBy: { order: 'asc' } } },
  });
  if (!document) notFound();
  return (
    <SendClient
      documentId={document.id}
      title={document.title}
      signerRoles={document.signerRoles}
      status={document.status}
    />
  );
}
