import { describe, expect, it } from 'vitest';
import { buildFolderTree } from './build-tree';

describe('buildFolderTree', () => {
  it('nests children under their parent', () => {
    const tree = buildFolderTree([
      { id: 'a', name: 'A', parentId: null },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'c', name: 'C', parentId: 'b' },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('a');
    expect(tree[0].children[0].id).toBe('b');
    expect(tree[0].children[0].children[0].id).toBe('c');
  });

  it('treats a folder with a missing parentId as a root', () => {
    const tree = buildFolderTree([
      { id: 'a', name: 'A', parentId: null },
      { id: 'orphan', name: 'Orphan', parentId: 'does-not-exist' },
    ]);
    expect(tree.map((n) => n.id).sort()).toEqual(['a', 'orphan']);
  });

  it('returns an empty array for no folders', () => {
    expect(buildFolderTree([])).toEqual([]);
  });
});
