export interface FolderNode {
  id: string;
  parentId: string | null;
}

export function wouldCreateCycle(
  folders: FolderNode[],
  folderId: string,
  newParentId: string
): boolean {
  if (folderId === newParentId) return true;
  const byId = new Map(folders.map((f) => [f.id, f]));
  let current = byId.get(newParentId);
  while (current) {
    if (current.id === folderId) return true;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}
