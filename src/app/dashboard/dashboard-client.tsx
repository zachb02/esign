'use client';

import { useCallback, useEffect, useState } from 'react';
import { FolderTree } from '@/components/folder-tree';
import { UploadDropzone } from '@/components/upload-dropzone';
import { DocumentGrid, type DocumentSummary } from '@/components/document-grid';

export function DashboardClient() {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);

  const loadDocuments = useCallback(async () => {
    const query = selectedFolderId ? `?folderId=${selectedFolderId}` : '?folderId=root';
    const response = await fetch(`/api/documents${query}`);
    if (!response.ok) {
      console.error('Failed to load documents', await response.text());
      return;
    }
    setDocuments(await response.json());
  }, [selectedFolderId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments, refreshToken]);

  return (
    <div className="flex h-screen">
      <aside className="w-64 shrink-0 overflow-y-auto border-r">
        <FolderTree
          selectedFolderId={selectedFolderId}
          onSelectFolder={setSelectedFolderId}
          refreshToken={refreshToken}
          onDocumentMoved={() => setRefreshToken((t) => t + 1)}
        />
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        <UploadDropzone
          folderId={selectedFolderId}
          onUploaded={() => setRefreshToken((t) => t + 1)}
        />
        <div className="mt-6">
          <DocumentGrid documents={documents} />
        </div>
      </main>
    </div>
  );
}
