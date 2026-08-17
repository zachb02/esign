import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// Same fake-worker path fix as render.ts — pdfjs-dist's Node worker resolution
// breaks under Next.js's webpack bundling without this. See render.ts for the
// full explanation; duplicated here rather than shared since each pdfjs-dist
// consumer in this codebase sets it independently.
pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(
  process.cwd(),
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
);

const MAX_CHARS = 60_000;

export interface ExtractedText {
  text: string;
  truncated: boolean;
}

export async function extractPdfText(pdfBuffer: Buffer): Promise<ExtractedText> {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
  const pdfDocument = await loadingTask.promise;
  const pageTexts: string[] = [];
  let totalChars = 0;

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    if (totalChars >= MAX_CHARS) break;
    const page = await pdfDocument.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    pageTexts.push(pageText);
    totalChars += pageText.length;
  }

  await pdfDocument.destroy();

  const fullText = pageTexts.join('\n\n');
  const truncated = fullText.length > MAX_CHARS;
  return {
    text: truncated ? fullText.slice(0, MAX_CHARS) : fullText,
    truncated,
  };
}
