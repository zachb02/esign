import { describe, expect, it } from 'vitest';
import { isDocumentEditable } from './lock';

describe('isDocumentEditable', () => {
  it('is true for DRAFT', () => {
    expect(isDocumentEditable('DRAFT')).toBe(true);
  });

  it('is false for every non-DRAFT status', () => {
    for (const status of ['SENT', 'IN_PROGRESS', 'COMPLETED', 'DECLINED', 'EXPIRED', 'ARCHIVED']) {
      expect(isDocumentEditable(status)).toBe(false);
    }
  });
});
