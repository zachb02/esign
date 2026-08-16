'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface SignerRoleSummary {
  id: string;
  name: string;
}

interface SendClientProps {
  documentId: string;
  title: string;
  signerRoles: SignerRoleSummary[];
  status: string;
}

interface RecipientLink {
  id: string;
  name: string;
  signingToken: string;
}

export function SendClient({ documentId, title, signerRoles, status }: SendClientProps) {
  const router = useRouter();
  const [assignments, setAssignments] = useState<Record<string, { name: string; email: string }>>(
    Object.fromEntries(signerRoles.map((r) => [r.id, { name: '', email: '' }]))
  );
  const [links, setLinks] = useState<RecipientLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (status !== 'DRAFT' && !links) {
    return (
      <div className="p-6">
        <p>This document has already been sent.</p>
      </div>
    );
  }

  async function handleSend() {
    const confirmed = window.confirm(
      `Send "${title}" now? Once sent, this document is locked and can no longer be edited.`
    );
    if (!confirmed) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/documents/${documentId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignments: signerRoles.map((role) => ({
            signerRoleId: role.id,
            name: assignments[role.id].name,
            email: assignments[role.id].email,
          })),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Failed to send' }));
        setError(body.error ?? 'Failed to send');
        return;
      }
      // response.ok is true past this point, so the server already
      // committed the send — a parse failure here isn't the same
      // "may or may not have happened" uncertainty as a network-level
      // failure below, so it gets its own message.
      let body: { recipients: RecipientLink[] };
      try {
        body = await response.json();
      } catch {
        setError(`This document was sent, but the server's response couldn't be read. Reload to see the signing links.`);
        router.refresh();
        return;
      }
      setLinks(body.recipients);
    } catch {
      setError(
        'Lost connection while sending — this document may or may not have actually been sent. Check the Documents list before trying again.'
      );
      router.refresh();
    } finally {
      setSending(false);
    }
  }

  if (links) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <h1 className="mb-4 text-lg font-semibold">Signing links for &quot;{title}&quot;</h1>
        <ul className="flex flex-col gap-3">
          {links.map((recipient) => {
            const url = `${window.location.origin}/sign/${recipient.signingToken}`;
            return (
              <li key={recipient.id} className="rounded border p-3">
                <p className="font-medium">{recipient.name}</p>
                <div className="mt-1 flex items-center gap-2">
                  <input readOnly value={url} className="flex-1 rounded border px-2 py-1 text-xs" />
                  <button
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() => navigator.clipboard.writeText(url)}
                  >
                    Copy
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="mb-4 text-lg font-semibold">Send &quot;{title}&quot;</h1>
      <div className="flex flex-col gap-4">
        {signerRoles.map((role) => (
          <div key={role.id} className="rounded border p-3">
            <p className="mb-2 text-sm font-medium">{role.name}</p>
            <input
              placeholder="Name"
              className="mb-2 w-full rounded border px-2 py-1 text-sm"
              value={assignments[role.id]?.name ?? ''}
              onChange={(event) =>
                setAssignments((prev) => ({
                  ...prev,
                  [role.id]: { ...prev[role.id], name: event.target.value },
                }))
              }
            />
            <input
              placeholder="Email"
              type="email"
              className="w-full rounded border px-2 py-1 text-sm"
              value={assignments[role.id]?.email ?? ''}
              onChange={(event) =>
                setAssignments((prev) => ({
                  ...prev,
                  [role.id]: { ...prev[role.id], email: event.target.value },
                }))
              }
            />
          </div>
        ))}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          disabled={sending}
          onClick={handleSend}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
