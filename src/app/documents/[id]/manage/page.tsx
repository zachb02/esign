import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { verifyAuditChain } from '@/lib/audit/verify';
import { isEmailConfigured } from '@/lib/email/send';
import { ManageClient } from './manage-client';

export default async function ManagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const document = await prisma.document.findUnique({
    where: { id },
    include: {
      recipients: { include: { signerRole: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!document) notFound();

  if (document.status === 'DRAFT') {
    return (
      <div className="mx-auto max-w-xl p-6">
        <h1 className="mb-4 text-lg font-semibold">&quot;{document.title}&quot;</h1>
        <p className="mb-4 text-sm text-neutral-500">
          This document hasn&apos;t been signed yet — place fields and sign it from the editor.
        </p>
        <div className="flex gap-3 text-sm">
          <Link href={`/documents/${document.id}/edit`} className="underline">
            Edit fields
          </Link>
        </div>
      </div>
    );
  }

  const auditEvents = await prisma.auditEvent.findMany({
    where: { documentId: document.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const chain = await verifyAuditChain(document.id);

  return (
    <ManageClient
      documentId={document.id}
      title={document.title}
      status={document.status}
      emailConfigured={isEmailConfigured()}
      recipients={document.recipients.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        roleName: r.signerRole.name,
        status: r.status,
        signingToken: r.signingToken,
      }))}
      auditEvents={auditEvents.map((e) => ({
        id: e.id,
        recipientId: e.recipientId,
        type: e.type,
        detail: e.detail,
        ipAddress: e.ipAddress,
        userAgent: e.userAgent,
        createdAt: e.createdAt.toISOString(),
      }))}
      chainVerified={chain.verified}
      chainBrokenAtIndex={chain.brokenAtIndex}
    />
  );
}
