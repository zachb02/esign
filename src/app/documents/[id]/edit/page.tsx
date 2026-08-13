import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { FieldEditor } from '@/components/field-editor/field-editor';

export default async function DocumentEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) notFound();
  return (
    <FieldEditor
      ownerType="document"
      ownerId={document.id}
      title={document.title}
      fileUrl={`/api/documents/${document.id}/file`}
    />
  );
}
