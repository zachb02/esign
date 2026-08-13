'use client';

import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface PdfViewerProps {
  documentId: string;
  title: string;
}

export function PdfViewer({ documentId, title }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);

  useEffect(() => {
    let cancelled = false;
    pdfjsLib.getDocument(`/api/documents/${documentId}/file`).promise.then((doc) => {
      if (cancelled) return;
      setPdfDoc(doc);
      setNumPages(doc.numPages);
    });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    pdfDoc.getPage(pageNumber).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext('2d')!;
      page.render({ canvasContext: context, viewport });
    });
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, pageNumber, scale]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="truncate font-medium">{title}</h1>
        <div className="flex items-center gap-3 text-sm">
          <button disabled={pageNumber <= 1} onClick={() => setPageNumber((p) => p - 1)}>
            Prev
          </button>
          <span>
            Page {pageNumber} of {numPages}
          </span>
          <button disabled={pageNumber >= numPages} onClick={() => setPageNumber((p) => p + 1)}>
            Next
          </button>
          <button onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}>-</button>
          <span>{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(3, s + 0.2))}>+</button>
        </div>
      </header>
      <div className="flex-1 overflow-auto bg-neutral-100 p-6">
        <canvas ref={canvasRef} className="mx-auto shadow" />
      </div>
    </div>
  );
}
