export interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
}

export interface FolderTreeNode extends FolderRecord {
  children: FolderTreeNode[];
}

export function buildFolderTree(folders: FolderRecord[]): FolderTreeNode[] {
  const nodes = new Map<string, FolderTreeNode>(
    folders.map((f) => [f.id, { ...f, children: [] }])
  );
  const roots: FolderTreeNode[] = [];
  for (const folder of folders) {
    const node = nodes.get(folder.id)!;
    const parent = folder.parentId ? nodes.get(folder.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
