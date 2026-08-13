'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface TemplateSummary {
  id: string;
  title: string;
  pageCount: number;
  thumbnailKey: string | null;
  updatedAt: string;
  _count: { signerRoles: number };
}

export function TemplatesClient() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadTemplates = useCallback(async () => {
    const response = await fetch('/api/templates');
    if (!response.ok) {
      console.error('Failed to load templates', await response.text());
      return;
    }
    setTemplates(await response.json());
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  async function uploadFiles(files: FileList | File[]) {
    const nextErrors: string[] = [];
    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/templates', { method: 'POST', body: formData });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Upload failed' }));
        nextErrors.push(`${file.name}: ${body.error ?? 'Upload failed'}`);
      }
    }
    setErrors(nextErrors);
    loadTemplates();
  }

  async function renameTemplate(id: string, currentTitle: string) {
    const title = window.prompt('Rename template', currentTitle);
    if (!title || title === currentTitle) return;
    const response = await fetch(`/api/templates/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Rename failed' }));
      window.alert(body.error ?? 'Rename failed');
      return;
    }
    loadTemplates();
  }

  async function deleteTemplate(id: string) {
    if (!window.confirm('Delete this template? This cannot be undone.')) return;
    const response = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Delete failed' }));
      window.alert(body.error ?? 'Delete failed');
      return;
    }
    loadTemplates();
  }

  async function useTemplate(id: string) {
    const response = await fetch(`/api/templates/${id}/use`, { method: 'POST' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to use template' }));
      window.alert(body.error ?? 'Failed to use template');
      return;
    }
    const document = await response.json();
    window.location.href = `/documents/${document.id}/edit`;
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Templates</h1>
        <div>
          <button
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
            onClick={() => inputRef.current?.click()}
          >
            + New Template
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files && event.target.files.length > 0) {
                uploadFiles(event.target.files);
                event.target.value = '';
              }
            }}
          />
        </div>
      </div>
      {errors.length > 0 && (
        <ul className="mb-4 space-y-1 text-sm text-red-600">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      {templates.length === 0 && (
        <p className="py-12 text-center text-sm text-neutral-400">No templates yet.</p>
      )}
      <div className="grid grid-cols-4 gap-4">
        {templates.map((template) => (
          <div key={template.id} className="flex flex-col gap-2 rounded-lg border p-3">
            <Link href={`/templates/${template.id}/edit`}>
              <img
                src={
                  template.thumbnailKey
                    ? `/api/templates/${template.id}/thumbnail`
                    : '/pdf-placeholder.svg'
                }
                alt=""
                className="h-32 w-full rounded border object-contain"
              />
            </Link>
            <p className="truncate font-medium">{template.title}</p>
            <p className="text-xs text-neutral-500">
              {template.pageCount} page{template.pageCount === 1 ? '' : 's'} ·{' '}
              {template._count.signerRoles} signer{template._count.signerRoles === 1 ? '' : 's'}
            </p>
            <div className="flex gap-2 text-xs">
              <button className="underline" onClick={() => useTemplate(template.id)}>
                Use
              </button>
              <button className="underline" onClick={() => renameTemplate(template.id, template.title)}>
                Rename
              </button>
              <button className="text-red-600 underline" onClick={() => deleteTemplate(template.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
