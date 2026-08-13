'use client';

import { useCallback, useEffect, useState } from 'react';
import { buildFolderTree, type FolderRecord, type FolderTreeNode } from '@/lib/folders/build-tree';

interface FolderTreeProps {
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  refreshToken: number;
  onDocumentMoved?: () => void;
}

export function FolderTree({
  selectedFolderId,
  onSelectFolder,
  refreshToken,
  onDocumentMoved,
}: FolderTreeProps) {
  const [folders, setFolders] = useState<FolderRecord[]>([]);

  const loadFolders = useCallback(async () => {
    const response = await fetch('/api/folders');
    if (!response.ok) {
      console.error('Failed to load folders', await response.text());
      return;
    }
    setFolders(await response.json());
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders, refreshToken]);

  async function createFolder(parentId: string | null) {
    const name = window.prompt('Folder name');
    if (!name) return;
    const response = await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parentId }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Request failed' }));
      window.alert(body.error ?? 'Failed to create folder');
      return;
    }
    loadFolders();
  }

  async function renameFolder(id: string, currentName: string) {
    const name = window.prompt('Rename folder', currentName);
    if (!name || name === currentName) return;
    const response = await fetch(`/api/folders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Request failed' }));
      window.alert(body.error ?? 'Failed to rename folder');
      return;
    }
    loadFolders();
  }

  async function deleteFolder(id: string) {
    if (!window.confirm('Delete this folder? Its documents and subfolders move up one level.')) {
      return;
    }
    const response = await fetch(`/api/folders/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Request failed' }));
      window.alert(body.error ?? 'Failed to delete folder');
      return;
    }
    if (selectedFolderId === id) onSelectFolder(null);
    loadFolders();
  }

  async function reparentFolder(id: string, newParentId: string | null) {
    const response = await fetch(`/api/folders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId: newParentId }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Request failed' }));
      window.alert(body.error ?? 'Failed to move folder');
      return;
    }
    loadFolders();
    onDocumentMoved?.();
  }

  async function moveDocumentToFolder(documentId: string, folderId: string | null) {
    const response = await fetch(`/api/documents/${documentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Request failed' }));
      window.alert(body.error ?? 'Failed to move document');
      return;
    }
    onDocumentMoved?.();
  }

  function handleDrop(event: React.DragEvent, targetFolderId: string | null) {
    event.preventDefault();
    const folderId = event.dataTransfer.getData('application/x-esign-folder-id');
    const documentId = event.dataTransfer.getData('application/x-esign-document-id');
    if (folderId && folderId !== targetFolderId) {
      reparentFolder(folderId, targetFolderId);
    } else if (documentId) {
      moveDocumentToFolder(documentId, targetFolderId);
    }
  }

  const tree = buildFolderTree(folders);

  return (
    <nav className="flex flex-col gap-1 p-3 text-sm">
      <button
        className={`rounded px-2 py-1 text-left hover:bg-neutral-100 ${
          selectedFolderId === null ? 'bg-neutral-100 font-medium' : ''
        }`}
        onClick={() => onSelectFolder(null)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDrop(event, null)}
      >
        Home
      </button>
      {tree.map((node) => (
        <FolderNode
          key={node.id}
          node={node}
          depth={0}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          onCreateChild={createFolder}
          onRename={renameFolder}
          onDelete={deleteFolder}
          onDrop={handleDrop}
        />
      ))}
      <button
        className="mt-2 rounded px-2 py-1 text-left text-neutral-500 hover:bg-neutral-100"
        onClick={() => createFolder(null)}
      >
        + New folder
      </button>
    </nav>
  );
}

interface FolderNodeProps {
  node: FolderTreeNode;
  depth: number;
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onCreateChild: (parentId: string | null) => void;
  onRename: (id: string, currentName: string) => void;
  onDelete: (id: string) => void;
  onDrop: (event: React.DragEvent, targetFolderId: string | null) => void;
}

function FolderNode({
  node,
  depth,
  selectedFolderId,
  onSelectFolder,
  onCreateChild,
  onRename,
  onDelete,
  onDrop,
}: FolderNodeProps) {
  return (
    <div>
      <div
        className={`group flex items-center justify-between rounded px-2 py-1 hover:bg-neutral-100 ${
          selectedFolderId === node.id ? 'bg-neutral-100 font-medium' : ''
        }`}
        style={{ paddingLeft: depth * 14 + 8 }}
        draggable
        onDragStart={(event) =>
          event.dataTransfer.setData('application/x-esign-folder-id', node.id)
        }
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => onDrop(event, node.id)}
        onClick={() => onSelectFolder(node.id)}
      >
        <span className="truncate">{node.name}</span>
        <span className="hidden gap-1 group-hover:flex">
          <button onClick={(e) => { e.stopPropagation(); onCreateChild(node.id); }} title="New subfolder">
            +
          </button>
          <button onClick={(e) => { e.stopPropagation(); onRename(node.id, node.name); }} title="Rename">
            ✎
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(node.id); }} title="Delete">
            ✕
          </button>
        </span>
      </div>
      {node.children.map((child) => (
        <FolderNode
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          onCreateChild={onCreateChild}
          onRename={onRename}
          onDelete={onDelete}
          onDrop={onDrop}
        />
      ))}
    </div>
  );
}
