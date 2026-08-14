import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import { Worker } from 'node:worker_threads';

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
// PNG structural well-formedness (fast, synchronous, no decompression)
//
// pdf-lib 1.17.1 bundles @pdf-lib/upng to decode PNG pixel data, and its
// inflate implementation enters an infinite SYNCHRONOUS loop when handed a
// truncated/incomplete deflate stream (confirmed empirically: a genuinely
// truncated PNG — cut off at 95%, 90%, 75%, 50%, 25%, or even 10% of its
// original length — hangs embedPng() forever; one case ran past 300s before
// being killed). Because the hang is a synchronous CPU loop with no I/O and
// no await point inside it, nothing on the JS side (try/catch, Promise.race,
// AbortController, setTimeout) can interrupt it — it pins the entire Node
// event loop until the process is killed. Since this endpoint is reachable
// by any recipient holding a valid signing token, calling embedPng() on
// unvalidated bytes is a real, remotely-triggerable, unrecoverable DoS.
//
// The fix is to validate the PNG chunk *structure* is complete before ever
// calling embedPng()/isPngFlattenable(). Truncation is, by definition, a
// chunk stream that is cut off before it's structurally complete — so this
// check never has to touch (let alone decompress) the compressed pixel
// bytes inside IDAT chunks. It only walks length-prefixed chunk headers and
// confirms the declared lengths are backed by actual bytes in the buffer,
// which is O(number of chunks), fully synchronous, and cannot loop: each
// iteration strictly advances `offset` by at least 12 (the minimum chunk
// overhead), so the loop is bounded by buffer.length / 12.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_CHUNK_HEADER_SIZE = 8; // 4-byte length + 4-byte type
const PNG_CHUNK_CRC_SIZE = 4;
const PNG_MIN_CHUNK_OVERHEAD = PNG_CHUNK_HEADER_SIZE + PNG_CHUNK_CRC_SIZE; // 12

export function isWellFormedPngStructure(buffer: Buffer): boolean {
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return false;
  }

  let offset = 8;
  let isFirstChunk = true;
  let sawIend = false;

  while (offset < buffer.length) {
    // Not enough bytes left for even a chunk header -> truncated.
    if (offset + PNG_CHUNK_HEADER_SIZE > buffer.length) {
      return false;
    }
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);

    if (isFirstChunk && type !== 'IHDR') {
      return false;
    }
    isFirstChunk = false;

    // The declared chunk must be fully backed by real bytes in the buffer
    // (data + trailing 4-byte CRC). This is exactly what catches
    // truncation: a truncated file's final declared chunk length claims
    // more bytes than the buffer actually has.
    if (offset + PNG_CHUNK_HEADER_SIZE + length + PNG_CHUNK_CRC_SIZE > buffer.length) {
      return false;
    }

    offset += PNG_CHUNK_HEADER_SIZE + length + PNG_CHUNK_CRC_SIZE;

    if (type === 'IEND') {
      // IEND must be zero-length and must end exactly at the buffer's end —
      // no chunk stream that runs out without reaching IEND, and no
      // trailing garbage after it.
      sawIend = true;
      return length === 0 && offset === buffer.length;
    }
  }

  return sawIend;
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
// isWellFormedPngStructure() above should always run first (see the route
// handler) so this only ever runs on structurally complete input — but it
// is independently hardened below regardless, because structural
// completeness is NOT sufficient to guarantee embedPng() terminates. We
// verified this directly: a structurally well-formed PNG (correct chunk
// lengths/CRCs) whose IDAT bytes are corrupted in place — not truncated —
// can *also* drive @pdf-lib/upng's inflate loop into the same
// non-terminating spin as the truncation case (reproduced: >90s with no
// completion, same symptom as the truncation hang). So a corrupted-but-
// structurally-valid PNG is not actually "caught" by a bare embedPng()
// call the way a normal parse error is — it can hang it, through the very
// call this module exists to make safe. Since no JS-level try/catch,
// await, or Promise.race can interrupt a synchronous infinite loop, the
// only real interrupt mechanism Node offers is running the risky call in a
// worker thread and forcibly terminate()-ing it if it blows a wall-clock
// budget — worker.terminate() kills the V8 isolate outright, unlike
// anything on the calling thread. A buffer that can't finish embedding
// within PNG_EMBED_TIMEOUT_MS is treated as not flattenable (rejected)
// rather than allowed to hang the server.
//
// Passing the worker source as an eval string (rather than a separate
// compiled worker file) is deliberate: a file-based Worker needs a
// resolvable path at runtime, which is fragile under Next.js's webpack
// bundling (a path that resolves under `vitest` has no guarantee of
// resolving inside the `.next` server output). An eval'd string has no
// such dependency — it runs with the current process's real module
// resolution wherever this process actually executes.
const PNG_EMBED_TIMEOUT_MS = 5000;

const PNG_EMBED_WORKER_SOURCE = `
const { parentPort, workerData } = require('worker_threads');
const { PDFDocument } = require('pdf-lib');
(async () => {
  try {
    const buffer = Buffer.from(workerData.buffer);
    const doc = await PDFDocument.create();
    await doc.embedPng(buffer);
    parentPort.postMessage(true);
  } catch {
    parentPort.postMessage(false);
  }
})();
`;

// Unlike the text font above, we intentionally do NOT reuse one long-lived
// PDFDocument across calls: pdf-lib has no API to evict an object once
// embedPng() registers it in a document's object graph, so a shared
// singleton would permanently accumulate every historical signature image
// for the life of the server process. PDFDocument.create() does no I/O and
// no font parsing, so creating a fresh throwaway document per check is
// cheap — the expensive part (parsing the PNG itself) is unavoidable work
// this check is specifically meant to do.
export async function isPngFlattenable(buffer: Buffer): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const worker = new Worker(PNG_EMBED_WORKER_SOURCE, {
      eval: true,
      workerData: { buffer },
    });

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Fire-and-forget: terminate() is async but we've already resolved
      // with the answer; nothing downstream needs to wait on teardown.
      void worker.terminate();
      resolve(result);
    };

    const timer = setTimeout(() => {
      // The worker has blown its budget — most likely a malformed PNG
      // that has driven the decoder into a non-terminating loop.
      // Terminating the isolate is the only way to reclaim it; treat this
      // exactly like a normal validation failure.
      finish(false);
    }, PNG_EMBED_TIMEOUT_MS);

    worker.once('message', (result: boolean) => finish(result));
    worker.once('error', () => finish(false));
  });
}
