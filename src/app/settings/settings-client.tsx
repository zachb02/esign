'use client';

import { useState } from 'react';

interface SettingsClientProps {
  openaiConfigured: boolean;
  anthropicConfigured: boolean;
}

function ApiKeyField({
  label,
  configured,
  onSave,
  onRemove,
}: {
  label: string;
  configured: boolean;
  onSave: (value: string) => Promise<string | null>;
  onRemove: () => Promise<string | null>;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfigured, setIsConfigured] = useState(configured);

  async function handleSave() {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    const err = await onSave(value.trim());
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setValue('');
    setIsConfigured(true);
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    const err = await onRemove();
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setIsConfigured(false);
  }

  return (
    <div className="rounded border p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className={`text-xs ${isConfigured ? 'text-green-700' : 'text-neutral-500'}`}>
          {isConfigured ? 'Configured' : 'Not set'}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={isConfigured ? 'Enter a new key to replace it' : 'Paste your API key'}
          className="flex-1 rounded border px-2 py-1 text-sm"
        />
        <button
          disabled={busy || !value.trim()}
          onClick={handleSave}
          className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          Save
        </button>
        {isConfigured && (
          <button
            disabled={busy}
            onClick={handleRemove}
            className="rounded border px-3 py-1 text-sm text-red-600 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function SettingsClient({ openaiConfigured, anthropicConfigured }: SettingsClientProps) {
  async function patch(body: object): Promise<string | null> {
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: 'Failed to save' }));
      return data.error ?? 'Failed to save';
    }
    return null;
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="mb-1 text-lg font-semibold">Settings</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Stored locally in this app&apos;s database — never in a file, never sent anywhere except
        the provider you choose. Add either key (or both) to enable the &quot;What am I
        signing?&quot; summary on the signing page.
      </p>
      <div className="flex flex-col gap-4">
        <ApiKeyField
          label="Anthropic API key"
          configured={anthropicConfigured}
          onSave={(value) => patch({ anthropicApiKey: value })}
          onRemove={() => patch({ anthropicApiKey: null })}
        />
        <ApiKeyField
          label="OpenAI API key"
          configured={openaiConfigured}
          onSave={(value) => patch({ openaiApiKey: value })}
          onRemove={() => patch({ openaiApiKey: null })}
        />
      </div>
    </div>
  );
}
