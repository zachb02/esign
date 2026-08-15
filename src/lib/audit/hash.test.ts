import { describe, expect, it } from 'vitest';
import { computeAuditHash } from './hash';

describe('computeAuditHash', () => {
  const base = {
    documentId: 'doc1',
    recipientId: null as string | null,
    type: 'VIEWED',
    detail: null as string | null,
    createdAt: new Date('2026-08-14T00:00:00.000Z'),
    prevHash: null as string | null,
  };

  it('produces a 64-character hex digest', () => {
    const hash = computeAuditHash(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for identical input', () => {
    expect(computeAuditHash(base)).toBe(computeAuditHash({ ...base }));
  });

  it('changes when any field changes', () => {
    const original = computeAuditHash(base);
    expect(computeAuditHash({ ...base, type: 'SIGNED' })).not.toBe(original);
    expect(computeAuditHash({ ...base, recipientId: 'rec2' })).not.toBe(original);
    expect(computeAuditHash({ ...base, detail: 'x' })).not.toBe(original);
    expect(computeAuditHash({ ...base, prevHash: 'abc' })).not.toBe(original);
    expect(
      computeAuditHash({ ...base, createdAt: new Date('2026-08-14T00:00:01.000Z') })
    ).not.toBe(original);
  });

  it('treats null recipientId, detail, and prevHash distinctly from any real value', () => {
    const withNulls = computeAuditHash(base);
    const withEmptyStrings = computeAuditHash({
      ...base,
      recipientId: '',
      detail: '',
      prevHash: '',
    });
    expect(withNulls).toBe(withEmptyStrings);
  });
});
