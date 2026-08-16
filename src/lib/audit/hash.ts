import { createHash } from 'node:crypto';

export interface AuditHashInput {
  documentId: string;
  recipientId: string | null;
  type: string;
  detail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  prevHash: string | null;
}

export function computeAuditHash(input: AuditHashInput): string {
  const payload = [
    input.documentId,
    input.recipientId ?? '',
    input.type,
    input.detail ?? '',
    input.ipAddress ?? '',
    input.userAgent ?? '',
    input.createdAt.toISOString(),
    input.prevHash ?? '',
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}
