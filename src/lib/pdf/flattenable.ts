import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';

// ---------------------------------------------------------------------------
// Text flattenability
//
// flatten.ts draws TEXT field values with PDFPage#drawText using the
// WinAnsi-encoded StandardFonts.Helvetica font. Before it ever reaches the
// font encoder, pdf-lib's own drawText() implementation:
//   1. Runs the string through its internal cleanText()/lineSplit()
//      preprocessing: tab (\t), NEL (U+0085), LINE SEPARATOR (U+2028), and
//      PARAGRAPH SEPARATOR (U+2029) become four spaces; backspace (\b) and
//      vertical tab (\v) are stripped outright; and \n \f \r split the
//      string into separate lines that get encoded (and drawn)
//      independently — none of those characters are ever handed to the
//      font encoder as-is.
//   2. Calls font.encodeText() on each resulting line, which throws
//      "WinAnsi cannot encode ..." for any character outside the font's
//      WinAnsi character set.
// We replicate that exact preprocessing (verified against the installed
// pdf-lib version: a full sweep of code points 0x00-0xFF through this
// function and through a real PDFPage#drawText() call produce the identical
// 58-character rejection set) and then call the very same public
// encodeText() API drawText() uses, so this check cannot drift from what
// flattening will actually do.
//
// We deliberately do NOT call page.drawText() directly here. Doing so would
// require either creating a fresh PDFDocument + page per call (this check
// runs on every field-save request) or appending to one long-lived shared
// page's content stream forever, which pdf-lib has no way to reset — an
// unbounded memory leak across the life of the server process. The font
// itself is stateless across encodeText() calls (see StandardFontEmbedder),
// so caching just the embedded font is safe to reuse indefinitely.
const CLEAN_TEXT_RE = /\t|\u0085|\u2028|\u2029/g;
const STRIP_CHARS_RE = /[\b\v]/g;
const LINE_SPLIT_RE = /[\n\f\r]/;

let probeFontPromise: Promise<PDFFont> | null = null;

function getProbeFont(): Promise<PDFFont> {
  if (!probeFontPromise) {
    probeFontPromise = PDFDocument.create().then((doc) => doc.embedFont(StandardFonts.Helvetica));
  }
  return probeFontPromise;
}

export async function isTextFlattenable(text: string): Promise<boolean> {
  if (text === '') return true;
  try {
    const font = await getProbeFont();
    const cleaned = text.replace(CLEAN_TEXT_RE, '    ').replace(STRIP_CHARS_RE, '');
    for (const line of cleaned.split(LINE_SPLIT_RE)) {
      font.encodeText(line);
    }
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// PNG flattenability
//
// flatten.ts embeds signature images with PDFDocument#embedPng. A buffer
// with a valid 8-byte PNG magic number but a corrupt body passes a
// magic-bytes-only check and gets stored, only to throw when embedPng()
// actually parses it at flatten time (caught by flatten.ts's per-field
// try/catch, so it no longer bricks the document — but the signer's
// signature silently never appears). We call the real embedPng() here so
// this check can't drift from what flattening actually does.
//
// Unlike the text font above, we intentionally do NOT reuse one long-lived
// PDFDocument across calls: pdf-lib has no API to evict an object once
// embedPng() registers it in a document's object graph, so a shared
// singleton would permanently accumulate every historical signature image
// for the life of the server process. PDFDocument.create() does no I/O and
// no font parsing, so creating a fresh throwaway document per check is
// cheap — the expensive part (parsing the PNG itself) is unavoidable work
// this check is specifically meant to do.
export async function isPngFlattenable(buffer: Buffer): Promise<boolean> {
  try {
    const doc = await PDFDocument.create();
    await doc.embedPng(buffer);
    return true;
  } catch {
    return false;
  }
}
