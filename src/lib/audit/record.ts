import { createHash } from 'node:crypto';
import type { Prisma, AuditEvent, AuditEventType } from '@prisma/client';
import { computeAuditHash } from './hash';

type TxClient = Prisma.TransactionClient;

function documentLockKey(documentId: string): bigint {
  return createHash('sha256').update(documentId).digest().readBigInt64BE(0);
}

// Serializes all audit-event reads/writes for one document within the
// calling transaction, using a Postgres advisory lock scoped to the
// transaction (released automatically at commit/rollback). Without this,
// two recipients acting on the same document at nearly the same moment
// (this app allows parallel any-order signing) could both read the same
// "latest event" and fork the hash chain instead of extending it linearly.
// Safe to call more than once per transaction — advisory locks are
// reentrant per session, so a caller that needs to check for an existing
// event before deciding whether to record a new one (see the VIEWED
// dedup logic in Task 4) can acquire this lock BEFORE that check, then
// call recordAuditEvent as usual; the lock it acquires internally is then
// a no-op re-grab, not a second wait.
export async function acquireDocumentAuditLock(tx: TxClient, documentId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${documentLockKey(documentId)})`;
}

export interface RecordAuditEventInput {
  documentId: string;
  recipientId?: string | null;
  type: AuditEventType;
  detail?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function recordAuditEvent(
  tx: TxClient,
  input: RecordAuditEventInput
): Promise<AuditEvent> {
  await acquireDocumentAuditLock(tx, input.documentId);

  const previous = await tx.auditEvent.findFirst({
    where: { documentId: input.documentId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  const createdAt = new Date();
  const recipientId = input.recipientId ?? null;
  const detail = input.detail ?? null;
  const ipAddress = input.ipAddress ?? null;
  const userAgent = input.userAgent ?? null;
  const contentHash = computeAuditHash({
    documentId: input.documentId,
    recipientId,
    type: input.type,
    detail,
    ipAddress,
    userAgent,
    createdAt,
    prevHash: previous?.contentHash ?? null,
  });

  return tx.auditEvent.create({
    data: {
      documentId: input.documentId,
      recipientId,
      type: input.type,
      detail,
      ipAddress,
      userAgent,
      createdAt,
      contentHash,
      prevHash: previous?.contentHash ?? null,
    },
  });
}
