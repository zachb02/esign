import { describe, expect, it } from 'vitest';
import { wouldCreateCycle } from './cycle-guard';

const folders = [
  { id: 'root', parentId: null },
  { id: 'child', parentId: 'root' },
  { id: 'grandchild', parentId: 'child' },
  { id: 'sibling', parentId: 'root' },
];

describe('wouldCreateCycle', () => {
  it('is true when moving a folder into itself', () => {
    expect(wouldCreateCycle(folders, 'child', 'child')).toBe(true);
  });

  it('is true when moving a folder into its own descendant', () => {
    expect(wouldCreateCycle(folders, 'root', 'grandchild')).toBe(true);
  });

  it('is false when moving a folder into an unrelated folder', () => {
    expect(wouldCreateCycle(folders, 'child', 'sibling')).toBe(false);
  });

  it('is false when moving a folder to become a root (no cycle possible)', () => {
    expect(wouldCreateCycle(folders, 'grandchild', 'sibling')).toBe(false);
  });
});
