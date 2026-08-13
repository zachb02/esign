import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { FieldEditor } from '@/components/field-editor/field-editor';

export default async function TemplateEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const template = await prisma.template.findUnique({ where: { id } });
  if (!template) notFound();
  return (
    <FieldEditor
      ownerType="template"
      ownerId={template.id}
      title={template.title}
      fileUrl={`/api/templates/${template.id}/file`}
    />
  );
}
