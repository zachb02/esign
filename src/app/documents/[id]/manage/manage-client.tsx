'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

interface RecipientView {
  id: string;
  name: string;
  email: string;
  roleName: string;
  status: string;
  signingToken: string;
}

interface AuditEventView {
  id: string;
  recipientId: string | null;
  type: string;
  detail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface ManageClientProps {
  documentId: string;
  title: string;
  status: string;
  emailConfigured: boolean;
  recipients: RecipientView[];
  auditEvents: AuditEventView[];
  chainVerified: boolean;
  chainBrokenAtIndex: number | null;
}

const RECIPIENT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  SIGNED: 'Signed',
  DECLINED: 'Declined',
};

function QrCode({ value }: { value: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current && value) {
      QRCode.toCanvas(canvasRef.current, value, { width: 96, margin: 1 });
    }
  }, [value]);
  return <canvas ref={canvasRef} className="rounded border" />;
}

export function ManageClient({
  documentId,
  title,
  status,
  emailConfigured,
  recipients,
  auditEvents,
  chainVerified,
  chainBrokenAtIndex,
}: ManageClientProps) {
  const [emailState, setEmailState] = useState<Record<string, 'idle' | 'sending' | 'sent' | 'error'>>(
    {}
  );
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  async function sendEmail(recipientId: string) {
    setEmailState((prev) => ({ ...prev, [recipientId]: 'sending' }));
    const response = await fetch(`/api/documents/${documentId}/recipients/${recipientId}/email`, {
      method: 'POST',
    });
    setEmailState((prev) => ({ ...prev, [recipientId]: response.ok ? 'sent' : 'error' }));
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-1 text-lg font-semibold">&quot;{title}&quot;</h1>
      <p className="mb-6 text-sm text-neutral-500">Status: {status}</p>

      {status === 'COMPLETED' && (
        <a
          href={`/api/documents/${documentId}/file?download=1`}
          download
          className="mb-8 inline-block rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Download signed PDF
        </a>
      )}

      <h2 className="mb-3 text-sm font-semibold uppercase text-neutral-500">Recipients</h2>
      <ul className="mb-8 flex flex-col gap-4">
        {recipients.map((recipient) => {
          const link = origin ? `${origin}/sign/${recipient.signingToken}` : '';
          const emailStatus = emailState[recipient.id] ?? 'idle';
          const emailButtonLabel =
            emailStatus === 'sending'
              ? 'Sending...'
              : emailStatus === 'sent'
                ? 'Sent'
                : emailStatus === 'error'
                  ? 'Failed - retry'
                  : 'Email';
          return (
            <li key={recipient.id} className="rounded border p-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="font-medium">{recipient.name}</p>
                  <p className="text-xs text-neutral-500">
                    {recipient.roleName} · {recipient.email}
                  </p>
                </div>
                <span className="text-xs">
                  {RECIPIENT_STATUS_LABELS[recipient.status] ?? recipient.status}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input readOnly value={link} className="flex-1 rounded border px-2 py-1 text-xs" />
                <button
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => navigator.clipboard.writeText(link)}
                >
                  Copy
                </button>
                {emailConfigured && (
                  <button
                    disabled={emailStatus === 'sending'}
                    onClick={() => sendEmail(recipient.id)}
                    className="rounded border px-2 py-1 text-xs disabled:opacity-50"
                  >
                    {emailButtonLabel}
                  </button>
                )}
              </div>
              {link && (
                <div className="mt-2">
                  <QrCode value={link} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <h2 className="mb-3 text-sm font-semibold uppercase text-neutral-500">
        Audit trail{' '}
        <span className={chainVerified ? 'text-green-600' : 'text-red-600'}>
          {chainVerified ? '· verified' : `· chain broken at event ${chainBrokenAtIndex}`}
        </span>
      </h2>
      <ul className="flex flex-col divide-y text-xs">
        {auditEvents.map((event) => {
          const recipient = recipients.find((r) => r.id === event.recipientId);
          return (
            <li key={event.id} className="flex items-center justify-between py-2">
              <span>
                {event.type}
                {recipient ? ` - ${recipient.name}` : ''}
                {event.detail ? ` (${event.detail})` : ''}
              </span>
              <span className="text-neutral-400">{new Date(event.createdAt).toLocaleString()}</span>
            </li>
          );
        })}
        {auditEvents.length === 0 && <li className="py-2 text-neutral-400">No events yet.</li>}
      </ul>
    </div>
  );
}
