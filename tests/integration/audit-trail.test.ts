import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { prisma } from '@/lib/db/prisma';
import { recordAuditEvent } from '@/lib/audit/record';
import { verifyAuditChain } from '@/lib/audit/verify';

beforeEach(async () => {
  await prisma.auditEvent.deleteMany();
  await prisma.recipient.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany();
  await prisma.recipient.deleteMany();
  await prisma.signerRole.deleteMany();
  await prisma.document.deleteMany();
  await prisma.$disconnect();
});

async function createDocument() {
  return prisma.document.create({
    data: {
      title: 'D',
      originalFilename: 'd.pdf',
      fileHash: 'h',
      storageKey: 'h.pdf',
      pageCount: 1,
      fileSizeBytes: 10,
      status: 'SENT',
    },
  });
}

describe('recordAuditEvent + verifyAuditChain', () => {
  it('builds a chain where each event points at the previous event\'s hash', async () => {
    const document = await createDocument();
    await prisma.$transaction((tx) =>
      recordAuditEvent(tx, { documentId: document.id, type: 'SENT' })
    );
    await prisma.$transaction((tx) =>
      recordAuditEvent(tx, { documentId: document.id, type: 'VIEWED' })
    );

    const events = await prisma.auditEvent.findMany({
      where: { documentId: document.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events).toHaveLength(2);
    expect(events[0].prevHash).toBeNull();
    expect(events[1].prevHash).toBe(events[0].contentHash);

    const result = await verifyAuditChain(document.id);
    expect(result).toEqual({ verified: true, brokenAtIndex: null });
  });

  it('detects tampering when an event row is modified directly', async () => {
    const document = await createDocument();
    await prisma.$transaction((tx) =>
      recordAuditEvent(tx, { documentId: document.id, type: 'SENT' })
    );
    await prisma.$transaction((tx) =>
      recordAuditEvent(tx, { documentId: document.id, type: 'VIEWED' })
    );
    const [first] = await prisma.auditEvent.findMany({
      where: { documentId: document.id },
      orderBy: { createdAt: 'asc' },
    });

    // Tamper directly via Prisma, bypassing recordAuditEvent entirely —
    // this is exactly the kind of modification the hash chain exists to
    // detect.
    await prisma.auditEvent.update({
      where: { id: first.id },
      data: { detail: 'tampered' },
    });

    const result = await verifyAuditChain(document.id);
    expect(result.verified).toBe(false);
    expect(result.brokenAtIndex).toBe(0);
  });

  it('returns verified for a document with no events', async () => {
    const document = await createDocument();
    const result = await verifyAuditChain(document.id);
    expect(result).toEqual({ verified: true, brokenAtIndex: null });
  });

  it('serializes concurrent recordAuditEvent calls into one linear chain with no forking', async () => {
    const document = await createDocument();
    await Promise.all([
      prisma.$transaction((tx) =>
        recordAuditEvent(tx, { documentId: document.id, type: 'VIEWED' })
      ),
      prisma.$transaction((tx) =>
        recordAuditEvent(tx, { documentId: document.id, type: 'VIEWED' })
      ),
    ]);

    const events = await prisma.auditEvent.findMany({ where: { documentId: document.id } });
    expect(events).toHaveLength(2);
    const nullPrevHashCount = events.filter((e) => e.prevHash === null).length;
    expect(nullPrevHashCount).toBe(1);

    const result = await verifyAuditChain(document.id);
    expect(result).toEqual({ verified: true, brokenAtIndex: null });
  });
});
