'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

export interface DocumentSummary {
  id: string;
  title: string;
  status: string;
  thumbnailKey: string | null;
  updatedAt: string;
  folderId: string | null;
}

interface DocumentGridProps {
  documents: DocumentSummary[];
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  ARCHIVED: 'Archived',
};

type SortKey = 'title' | 'updatedAt' | 'status';

export function DocumentGrid({ documents }: DocumentGridProps) {
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const sorted = useMemo(() => {
    return [...documents].sort((a, b) => {
      if (sortKey === 'updatedAt') {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
      return a[sortKey].localeCompare(b[sortKey]);
    });
  }, [documents, sortKey]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <select
          className="rounded border px-2 py-1 text-sm"
          value={sortKey}
          onChange={(event) => setSortKey(event.target.value as SortKey)}
        >
          <option value="updatedAt">Last updated</option>
          <option value="title">Title</option>
          <option value="status">Status</option>
        </select>
        <div className="flex gap-2 text-sm">
          <button
            className={view === 'grid' ? 'font-medium underline' : 'text-neutral-500'}
            onClick={() => setView('grid')}
          >
            Grid
          </button>
          <button
            className={view === 'list' ? 'font-medium underline' : 'text-neutral-500'}
            onClick={() => setView('list')}
          >
            List
          </button>
        </div>
      </div>
      {sorted.length === 0 && (
        <p className="py-12 text-center text-sm text-neutral-400">No documents here yet.</p>
      )}
      <div className={view === 'grid' ? 'grid grid-cols-4 gap-4' : 'flex flex-col divide-y'}>
        {sorted.map((doc) => (
          <Link
            key={doc.id}
            href={`/documents/${doc.id}`}
            draggable
            onDragStart={(event) =>
              event.dataTransfer.setData('application/x-esign-document-id', doc.id)
            }
            className={
              view === 'grid'
                ? 'flex flex-col gap-2 rounded-lg border p-3 hover:border-neutral-400'
                : 'flex items-center gap-3 py-2 hover:bg-neutral-50'
            }
          >
            <img
              src={doc.thumbnailKey ? `/api/documents/${doc.id}/thumbnail` : '/pdf-placeholder.svg'}
              alt=""
              className={
                view === 'grid'
                  ? 'h-32 w-full rounded border object-cover'
                  : 'h-10 w-8 rounded border object-cover'
              }
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{doc.title}</p>
              <p className="text-xs text-neutral-500">{STATUS_LABELS[doc.status]}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
