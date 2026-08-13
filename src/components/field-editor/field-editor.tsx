'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { FieldPalette } from './field-palette';
import { FieldBox } from './field-box';
import type { FieldOwnerType, FieldRecord, FieldTypeValue, SignerRoleRecord } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface FieldEditorProps {
  ownerType: FieldOwnerType;
  ownerId: string;
  title: string;
  fileUrl: string;
}

export function FieldEditor({ ownerType, ownerId, title, fileUrl }: FieldEditorProps) {
  const [roles, setRoles] = useState<SignerRoleRecord[]>([]);
  const [fields, setFields] = useState<FieldRecord[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const pageRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);

  const query = `ownerType=${ownerType}&ownerId=${ownerId}`;

  const loadRoles = useCallback(async () => {
    const response = await fetch(`/api/signer-roles?${query}`);
    if (!response.ok) return;
    const data: SignerRoleRecord[] = await response.json();
    setRoles(data);
    setSelectedRoleId((current) => current ?? (data.length > 0 ? data[0].id : null));
  }, [query]);

  const loadFields = useCallback(async () => {
    const response = await fetch(`/api/fields?${query}`);
    if (!response.ok) return;
    setFields(await response.json());
  }, [query]);

  useEffect(() => {
    loadRoles();
    loadFields();
  }, [loadRoles, loadFields]);

  useEffect(() => {
    let cancelled = false;
    pdfjsLib.getDocument(fileUrl).promise.then((doc) => {
      if (cancelled) return;
      pdfDocRef.current = doc;
      setNumPages(doc.numPages);
    });
    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  const renderPage = useCallback(async (pageNumber: number) => {
    const doc = pdfDocRef.current;
    const canvas = pageRefs.current[pageNumber];
    if (!doc || !canvas) return;
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.2 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d')!;
    await page.render({ canvasContext: context, viewport }).promise;
  }, []);

  useEffect(() => {
    for (let page = 1; page <= numPages; page += 1) {
      renderPage(page);
    }
  }, [numPages, renderPage]);

  async function addRole() {
    const response = await fetch('/api/signer-roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType, ownerId }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to add signer role' }));
      window.alert(body.error ?? 'Failed to add signer role');
      return;
    }
    const role = await response.json();
    setSelectedRoleId(role.id);
    loadRoles();
  }

  async function createField(type: FieldTypeValue, page: number, x: number, y: number) {
    const response = await fetch('/api/fields', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerType, ownerId, type, page, x, y, signerRoleId: selectedRoleId }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to create field' }));
      window.alert(body.error ?? 'Failed to create field');
      return;
    }
    loadFields();
    loadRoles();
  }

  async function patchField(id: string, data: Record<string, unknown>) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...data } : f)));
    const response = await fetch(`/api/fields/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to update field' }));
      window.alert(body.error ?? 'Failed to update field');
      loadFields();
    }
  }

  async function deleteField(id: string) {
    const response = await fetch(`/api/fields/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to delete field' }));
      window.alert(body.error ?? 'Failed to delete field');
      return;
    }
    setSelectedFieldId(null);
    loadFields();
  }

  function handleDropOnPage(page: number, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/x-esign-field-type') as FieldTypeValue;
    if (!type) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    createField(type, page, x, y);
  }

  return (
    <div className="flex h-full">
      <FieldPalette
        roles={roles}
        selectedRoleId={selectedRoleId}
        onSelectRole={setSelectedRoleId}
        onAddRole={addRole}
        onDragFieldType={(type, event) =>
          event.dataTransfer.setData('application/x-esign-field-type', type)
        }
      />
      <div
        className="flex-1 overflow-y-auto bg-neutral-100 p-6"
        onClick={() => setSelectedFieldId(null)}
      >
        <h1 className="mb-4 font-medium">{title}</h1>
        <div className="flex flex-col items-center gap-6">
          {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => (
            <div
              key={page}
              data-page-surface
              className="relative shadow"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDropOnPage(page, event)}
            >
              <canvas
                ref={(el) => {
                  pageRefs.current[page] = el;
                }}
              />
              {fields
                .filter((f) => f.page === page)
                .map((field) => (
                  <FieldBox
                    key={field.id}
                    field={field}
                    role={roles.find((r) => r.id === field.signerRoleId)}
                    roles={roles}
                    isSelected={selectedFieldId === field.id}
                    onSelect={() => setSelectedFieldId(field.id)}
                    onMove={(x, y) => patchField(field.id, { x, y })}
                    onResize={(width, height) => patchField(field.id, { width, height })}
                    onReassignRole={(roleId) => patchField(field.id, { signerRoleId: roleId })}
                    onToggleRequired={() => patchField(field.id, { required: !field.required })}
                    onDelete={() => deleteField(field.id)}
                  />
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
