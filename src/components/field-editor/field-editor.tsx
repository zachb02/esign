'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  const router = useRouter();
  const [roles, setRoles] = useState<SignerRoleRecord[]>([]);
  const [fields, setFields] = useState<FieldRecord[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const isLoading = numPages === 0;
  const [signing, setSigning] = useState(false);
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

  async function deleteRole(roleId: string) {
    const response = await fetch(`/api/signer-roles/${roleId}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to delete signer role' }));
      window.alert(body.error ?? 'Failed to delete signer role');
      return;
    }
    if (selectedRoleId === roleId) {
      setSelectedRoleId(null);
    }
    loadRoles();
    loadFields();
  }

  async function renameRole(roleId: string, name: string) {
    const response = await fetch(`/api/signer-roles/${roleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to rename signer role' }));
      window.alert(body.error ?? 'Failed to rename signer role');
      loadRoles();
      return;
    }
    loadRoles();
  }

  async function signAsRole(roleId: string) {
    if (signing) return;
    if (fields.length === 0) {
      window.alert('Add at least one field before signing');
      return;
    }
    const role = roles.find((r) => r.id === roleId);
    const confirmed = window.confirm(
      `This will send "${title}" for signing as ${role?.name ?? 'this role'} right now. ` +
        'The document will be locked and can no longer be edited here. Continue?'
    );
    if (!confirmed) return;
    setSigning(true);
    try {
      const response = await fetch(`/api/documents/${ownerId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignments: roles.map((role) => ({
            signerRoleId: role.id,
            name: role.name,
            email: `preview-${role.id}@local.test`,
          })),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Failed to send' }));
        window.alert(body.error ?? 'Failed to send');
        return;
      }
      const body = await response.json();
      const recipient = body.recipients.find((r: { signerRoleId: string }) => r.signerRoleId === roleId);
      if (recipient) {
        router.push(`/sign/${recipient.signingToken}`);
        return;
      }
      // The document was sent successfully (every current role got a real
      // recipient), but the specific role that was clicked isn't among
      // them — it must have been deleted (e.g. from another tab) between
      // this tab's last role fetch and this click. The send already
      // happened and can't be undone, so surface that clearly instead of
      // silently doing nothing, and refresh so this page reflects the
      // document's new locked state.
      window.alert(
        'This document was sent, but the signer role you clicked no longer exists. Check the Manage page for the signing links.'
      );
      router.refresh();
    } finally {
      setSigning(false);
    }
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
      return;
    }
    const updated: FieldRecord = await response.json();
    setFields((prev) => prev.map((f) => (f.id === id ? updated : f)));
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
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="truncate text-sm font-medium">{title}</span>
        {ownerType === 'document' && (
          <Link
            href={`/documents/${ownerId}/send`}
            aria-disabled={fields.length === 0}
            className={
              fields.length === 0
                ? 'pointer-events-none rounded border px-3 py-1 text-sm text-neutral-300'
                : 'rounded border px-3 py-1 text-sm hover:bg-neutral-50'
            }
          >
            Send
          </Link>
        )}
      </div>
      <div className="flex flex-1 overflow-hidden">
        <FieldPalette
          roles={roles}
          selectedRoleId={selectedRoleId}
          onSelectRole={setSelectedRoleId}
          onAddRole={addRole}
          onDeleteRole={deleteRole}
          onRenameRole={renameRole}
          onSignAsRole={ownerType === 'document' ? signAsRole : undefined}
          signingDisabled={signing}
          onDragFieldType={(type, event) =>
            event.dataTransfer.setData('application/x-esign-field-type', type)
          }
        />
        <div
          className="flex-1 overflow-y-auto bg-neutral-100 p-6"
          onClick={() => setSelectedFieldId(null)}
        >
          <h1 className="mb-4 font-medium">{title}</h1>
          {isLoading ? (
            <p className="p-6 text-center text-sm text-neutral-500">Loading document…</p>
          ) : (
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
                        onToggleRequired={() =>
                          patchField(field.id, { required: !field.required })
                        }
                        onDelete={() => deleteField(field.id)}
                      />
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
