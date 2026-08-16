import { prisma } from '@/lib/db/prisma';
import { computeAuditHash } from './hash';

export interface AuditChainResult {
  verified: boolean;
  brokenAtIndex: number | null;
}

export async function verifyAuditChain(documentId: string): Promise<AuditChainResult> {
  const events = await prisma.auditEvent.findMany({
    where: { documentId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  let expectedPrevHash: string | null = null;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (event.prevHash !== expectedPrevHash) {
      return { verified: false, brokenAtIndex: i };
    }
    const recomputed = computeAuditHash({
      documentId: event.documentId,
      recipientId: event.recipientId,
      type: event.type,
      detail: event.detail,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      createdAt: event.createdAt,
      prevHash: event.prevHash,
    });
    if (recomputed !== event.contentHash) {
      return { verified: false, brokenAtIndex: i };
    }
    expectedPrevHash = event.contentHash;
  }
  return { verified: true, brokenAtIndex: null };
}
