const PDF_MAGIC = Buffer.from('%PDF-');

export function isPdfBuffer(data: Buffer): boolean {
  if (data.length < PDF_MAGIC.length) return false;
  return data.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
}

export class InvalidPdfError extends Error {
  constructor(message = 'File is not a valid PDF') {
    super(message);
    this.name = 'InvalidPdfError';
  }
}

export function assertValidPdf(data: Buffer): void {
  if (!isPdfBuffer(data)) {
    throw new InvalidPdfError();
  }
}
