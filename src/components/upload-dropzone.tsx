'use client';

import { useCallback, useRef, useState } from 'react';

interface UploadDropzoneProps {
  folderId: string | null;
  onUploaded: () => void;
}

export function UploadDropzone({ folderId, onUploaded }: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const nextErrors: string[] = [];
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        if (folderId) formData.append('folderId', folderId);
        const response = await fetch('/api/documents', { method: 'POST', body: formData });
        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: 'Upload failed' }));
          nextErrors.push(`${file.name}: ${body.error ?? 'Upload failed'}`);
        }
      }
      setErrors(nextErrors);
      onUploaded();
    },
    [folderId, onUploaded]
  );

  return (
    <div
      className={`rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors ${
        isDragging ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-300'
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        if (event.dataTransfer.files.length > 0) {
          uploadFiles(event.dataTransfer.files);
        }
      }}
    >
      <p className="text-neutral-600">
        Drag PDFs here, or{' '}
        <button className="underline" onClick={() => inputRef.current?.click()}>
          browse
        </button>
      </p>
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
      {errors.length > 0 && (
        <ul className="mt-3 space-y-1 text-left text-red-600">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
