import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';

// pdfjs-dist's Node "fake worker" defaults `GlobalWorkerOptions.workerSrc` to the
// relative specifier "./pdf.worker.mjs", resolved against pdf.mjs's own
// `import.meta.url`. When this module is bundled by Next.js's dev server webpack
// build, that relative path no longer points at a real file on disk (it resolves
// into the webpack vendor-chunk output, which doesn't contain the worker file),
// so `getDocument()` throws "Setting up fake worker failed". Pointing
// `workerSrc` at the actual on-disk file up front avoids that relative lookup;
// pdfjs-dist loads it via a webpack-ignored dynamic `import()`, so this works
// whether or not this module itself is bundled.
pdfjsLib.GlobalWorkerOptions.workerSrc = path.join(
  process.cwd(),
  'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
);

interface CanvasAndContext {
  canvas: Canvas;
  context: SKRSContext2D;
}

class NodeCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    return { canvas, context };
  }

  reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext: CanvasAndContext): void {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

export async function getPdfPageCount(pdfBuffer: Buffer): Promise<number> {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
  const pdfDocument = await loadingTask.promise;
  const count = pdfDocument.numPages;
  await pdfDocument.destroy();
  return count;
}

export async function renderPdfPageToPng(
  pdfBuffer: Buffer,
  pageNumber: number,
  scale = 1.0
): Promise<Buffer> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    disableFontFace: true,
    // Required so pdfjs-dist can source glyph outlines for PDF "standard 14"
    // fonts (Helvetica, Times, Courier, ...) that are referenced by name only
    // rather than embedded as a font program in the PDF. This is extremely
    // common (e.g. pdf-lib's StandardFonts.Helvetica). Without this, and with
    // disableFontFace preventing browser-style @font-face substitution,
    // pdfjs-dist silently drops all such glyphs and only vector graphics
    // (lines/rectangles/images) render, producing blank-looking thumbnails.
    standardFontDataUrl: path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/'),
  });
  const pdfDocument = await loadingTask.promise;
  const page = await pdfDocument.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvasFactory = new NodeCanvasFactory();
  const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);

  await page.render({
    canvasContext: canvasAndContext.context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;

  const buffer = canvasAndContext.canvas.toBuffer('image/png');
  await pdfDocument.destroy();
  return Buffer.from(buffer);
}
