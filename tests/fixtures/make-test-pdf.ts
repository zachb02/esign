import { PDFDocument, StandardFonts } from 'pdf-lib';

interface MakeTestPdfOptions {
  /**
   * Draw a line of text on each page using a PDF "standard 14" font
   * (Helvetica) referenced by name only, not embedded as a font program.
   * This mirrors how most real-world PDFs reference standard fonts, and is
   * the condition under which pdfjs-dist requires `standardFontDataUrl` to
   * render glyphs server-side (see src/lib/pdf/render.ts).
   */
  withText?: boolean;
}

export async function makeTestPdf(
  pageCount = 1,
  options: MakeTestPdfOptions = {}
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = options.withText ? await doc.embedFont(StandardFonts.Helvetica) : undefined;
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([200, 200]);
    if (font) {
      page.drawText(`Test page ${i + 1}`, {
        x: 20,
        y: 100,
        size: 24,
        font,
      });
    }
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}
