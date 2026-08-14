import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { FieldEditor } from '@/components/field-editor/field-editor';
import { isDocumentEditable } from '@/lib/documents/lock';

export default async function DocumentEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) notFound();

  if (!isDocumentEditable(document.status)) {
    return (
      <div className="p-6">
        <p>
          &quot;{document.title}&quot; can no longer be edited (status:{' '}
          {document.status.replace('_', ' ').toLowerCase()}).
        </p>
      </div>
    );
  }

  return (
    <FieldEditor
      ownerType="document"
      ownerId={document.id}
      title={document.title}
      fileUrl={`/api/documents/${document.id}/file`}
    />
  );
}
