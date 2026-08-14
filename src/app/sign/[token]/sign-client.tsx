'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { SignaturePad } from '@/components/signature-pad';
import { FIELD_TYPE_LABELS } from '@/lib/fields/field-defaults';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface FieldValueRecord {
  textValue: string | null;
  checked: boolean | null;
  signatureImageKey: string | null;
  dateValue: string | null;
}

interface FieldRecord {
  id: string;
  type: 'SIGNATURE' | 'INITIALS' | 'DATE_SIGNED' | 'TEXT' | 'CHECKBOX';
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  value: FieldValueRecord | null;
}

interface SessionData {
  recipient: { id: string; name: string; status: string; declineReason: string | null };
  document: { id: string; title: string; pageCount: number; status: string };
  fields: FieldRecord[];
}

interface SignClientProps {
  token: string;
}

export function SignClient({ token }: SignClientProps) {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [activeSignatureFieldId, setActiveSignatureFieldId] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const pageRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);

  const loadSession = useCallback(async () => {
    const response = await fetch(`/api/sign/${token}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Signing link not found' }));
      setLoadError(body.error ?? 'Signing link not found');
      return;
    }
    setSession(await response.json());
  }, [token]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    pdfjsLib.getDocument(`/api/documents/${session.document.id}/file`).promise.then((doc) => {
      if (cancelled) return;
      pdfDocRef.current = doc;
      setNumPages(doc.numPages);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

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

  async function saveTextValue(fieldId: string, textValue: string) {
    const response = await fetch(`/api/sign/${token}/fields/${fieldId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ textValue }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to save value' }));
      window.alert(body.error ?? 'Failed to save value');
      // The TEXT input is uncontrolled and only resyncs to the server's
      // value via its `key` prop. Without this, a rejected edit stays
      // visible in the DOM even though the database still holds the old
      // value, so it could get silently flattened into the final document.
      // Reload so the input remounts showing the actual (unchanged) value.
      loadSession();
      return;
    }
    loadSession();
  }

  async function saveChecked(fieldId: string, checked: boolean) {
    const response = await fetch(`/api/sign/${token}/fields/${fieldId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checked }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to save value' }));
      window.alert(body.error ?? 'Failed to save value');
    }
    loadSession();
  }

  async function saveSignature(fieldId: string, blob: Blob) {
    const formData = new FormData();
    formData.append('image', blob, 'signature.png');
    const response = await fetch(`/api/sign/${token}/fields/${fieldId}`, {
      method: 'PATCH',
      body: formData,
    });
    setActiveSignatureFieldId(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to save signature' }));
      window.alert(body.error ?? 'Failed to save signature');
    }
    loadSession();
  }

  async function handleComplete() {
    setCompleting(true);
    const response = await fetch(`/api/sign/${token}/complete`, { method: 'POST' });
    setCompleting(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to complete' }));
      window.alert(body.error ?? 'Failed to complete');
      return;
    }
    loadSession();
  }

  async function handleDecline() {
    if (!window.confirm('Are you sure you want to decline to sign this document?')) return;
    const reason = window.prompt('Reason (optional):') ?? undefined;
    const response = await fetch(`/api/sign/${token}/decline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Failed to decline' }));
      window.alert(body.error ?? 'Failed to decline');
      return;
    }
    loadSession();
  }

  if (loadError) {
    return <div className="p-6 text-center text-neutral-500">{loadError}</div>;
  }

  if (!session) {
    return <div className="p-6 text-center text-neutral-500">Loading...</div>;
  }

  if (session.recipient.status === 'SIGNED') {
    return <div className="p-6 text-center">You already signed this document. Thank you!</div>;
  }

  if (session.recipient.status === 'DECLINED') {
    return <div className="p-6 text-center">You declined to sign this document.</div>;
  }

  if (session.document.status === 'DECLINED') {
    return (
      <div className="p-6 text-center">
        This document was declined by another signer and can no longer be signed.
      </div>
    );
  }

  const allRequiredFilled = session.fields
    .filter((f) => f.required && f.type !== 'DATE_SIGNED')
    .every((f) => f.value !== null);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="font-medium">{session.document.title}</h1>
        <div className="flex gap-2">
          <button onClick={handleDecline} className="rounded border px-3 py-1.5 text-sm text-red-600">
            Decline to Sign
          </button>
          <button
            disabled={!allRequiredFilled || completing}
            onClick={handleComplete}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {completing ? 'Completing...' : 'Complete Signing'}
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto bg-neutral-100 p-6">
        <div className="flex flex-col items-center gap-6">
          {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => (
            <div key={page} className="relative shadow">
              <canvas
                ref={(el) => {
                  pageRefs.current[page] = el;
                }}
              />
              {session.fields
                .filter((f) => f.page === page)
                .map((field) => (
                  <div
                    key={field.id}
                    className="absolute flex items-center justify-center border-2 border-blue-600 bg-blue-100/40"
                    style={{
                      left: `${field.x * 100}%`,
                      top: `${field.y * 100}%`,
                      width: `${field.width * 100}%`,
                      height: `${field.height * 100}%`,
                    }}
                  >
                    {(field.type === 'SIGNATURE' || field.type === 'INITIALS') && (
                      <>
                        {field.value?.signatureImageKey ? (
                          <span className="text-[10px] text-green-700">Signed ✓</span>
                        ) : (
                          <button
                            className="text-[10px] underline"
                            onClick={() => setActiveSignatureFieldId(field.id)}
                          >
                            {FIELD_TYPE_LABELS[field.type]}
                          </button>
                        )}
                        {activeSignatureFieldId === field.id && (
                          <div className="absolute left-0 top-full z-10 mt-2 rounded border bg-white p-2 shadow">
                            <SignaturePad onSave={(blob) => saveSignature(field.id, blob)} />
                          </div>
                        )}
                      </>
                    )}
                    {field.type === 'TEXT' && (
                      <input
                        key={`${field.id}-${field.value?.textValue ?? 'empty'}`}
                        defaultValue={field.value?.textValue ?? ''}
                        onBlur={(event) => saveTextValue(field.id, event.target.value)}
                        className="h-full w-full bg-transparent px-1 text-[10px] outline-none"
                      />
                    )}
                    {field.type === 'CHECKBOX' && (
                      <input
                        type="checkbox"
                        defaultChecked={field.value?.checked ?? false}
                        onChange={(event) => saveChecked(field.id, event.target.checked)}
                      />
                    )}
                    {field.type === 'DATE_SIGNED' && (
                      <span className="text-[9px] text-neutral-500">Date signed (auto)</span>
                    )}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
