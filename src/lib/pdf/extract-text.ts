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

export async function extractPdfText(
  pdfBuffer: Buffer,
  maxChars: number = MAX_CHARS
): Promise<ExtractedText> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    // Same fix render.ts needs for rendering standard-14 fonts (Helvetica,
    // etc. referenced by name only, not embedded) — without it pdfjs-dist
    // can't resolve glyph-to-Unicode mapping for that text and getTextContent
    // silently returns incomplete/empty items for affected pages instead of
    // throwing, which would otherwise corrupt the truncation-boundary logic.
    standardFontDataUrl: path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/'),
  });
  const pdfDocument = await loadingTask.promise;
  const pageTexts: string[] = [];
  let totalChars = 0;
  // Tracked explicitly rather than derived after the fact from a length
  // comparison — deriving it from `fullText.length > MAX_CHARS` missed the
  // case where the per-page loop broke early on a page boundary that landed
  // exactly at the cap, silently dropping the remaining pages while still
  // reporting truncated: false.
  let truncated = false;

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    if (totalChars >= maxChars) {
      truncated = true;
      break;
    }
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

  let fullText = pageTexts.join('\n\n');
  if (fullText.length > maxChars) {
    fullText = fullText.slice(0, maxChars);
    truncated = true;
  }
  return { text: fullText, truncated };
}
