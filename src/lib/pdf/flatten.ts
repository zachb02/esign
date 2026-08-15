import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { FieldType } from '@prisma/client';

export interface FlattenFieldInput {
  type: FieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  textValue: string | null;
  checked: boolean | null;
  signaturePng: Buffer | null;
  dateValue: Date | null;
}

export async function flattenPdf(
  pdfBuffer: Buffer,
  fields: FlattenFieldInput[]
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  for (const field of fields) {
    const page = pages[field.page - 1];
    if (!page) continue;

    const { width: pageWidth, height: pageHeight } = page.getSize();
    const boxX = field.x * pageWidth;
    const boxWidth = field.width * pageWidth;
    const boxHeight = field.height * pageHeight;
    // field.y is a fraction from the TOP of the page (matches the browser/CSS
    // convention used by the field editor's overlay). pdf-lib's origin is the
    // bottom-left corner, so the box's bottom edge is pageHeight minus the
    // top offset minus the box height.
    const boxTopY = pageHeight - field.y * pageHeight;
    const boxBottomY = boxTopY - boxHeight;

    // Defense in depth: any single field's draw call can throw (bad/legacy
    // data that predates route-level validation, a corrupt signature PNG,
    // etc.). One bad field must never abort flattening for every other
    // field — catch, log, and move on so the function always returns a
    // valid PDF covering everything that COULD be drawn.
    try {
      if ((field.type === 'SIGNATURE' || field.type === 'INITIALS') && field.signaturePng) {
        const pngImage = await pdfDoc.embedPng(field.signaturePng);
        page.drawImage(pngImage, { x: boxX, y: boxBottomY, width: boxWidth, height: boxHeight });
      } else if (field.type === 'TEXT' && field.textValue) {
        const fontSize = Math.min(boxHeight * 0.7, 12);
        page.drawText(field.textValue, {
          x: boxX + 2,
          y: boxBottomY + (boxHeight - fontSize) / 2,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      } else if (field.type === 'CHECKBOX' && field.checked) {
        const fontSize = boxHeight * 0.8;
        page.drawText('X', {
          x: boxX + boxWidth * 0.15,
          y: boxBottomY + boxHeight * 0.15,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      } else if (field.type === 'DATE_SIGNED' && field.dateValue) {
        const dateString = field.dateValue.toISOString().slice(0, 10);
        const fontSize = Math.min(boxHeight * 0.7, 12);
        page.drawText(dateString, {
          x: boxX + 2,
          y: boxBottomY + (boxHeight - fontSize) / 2,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      }
    } catch (error) {
      console.error(`flattenPdf: failed to draw field ${field.type} on page ${field.page}, skipping`, error);
    }
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

export interface CertificateRecipientInput {
  name: string;
  email: string;
  roleName: string;
  status: string;
  signedAt: Date | null;
  declinedAt: Date | null;
  ipAddress: string | null;
}

export interface AppendCertificateInput {
  recipients: CertificateRecipientInput[];
  chainSummary: string;
}

export async function appendCertificate(
  pdfBuffer: Buffer,
  input: AppendCertificateInput
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const page = pdfDoc.addPage([612, 792]); // US Letter
  const left = 54;
  let y = 740;

  page.drawText('Certificate of Completion', {
    x: left,
    y,
    size: 18,
    font: boldFont,
    color: rgb(0, 0, 0),
  });
  y -= 30;

  for (const recipient of input.recipients) {
    // Recipient name/email is free text collected at Send time with no
    // WinAnsi-encoding validation (unlike field values, which ARE
    // validated - see isTextFlattenable). One recipient with an
    // unsupported character must never abort the whole certificate page,
    // which would abort the whole completion transaction and permanently
    // strand an already-fully-signed document - the same bricking failure
    // mode Phase 3 fixed for field values.
    try {
      const eventLabel =
        recipient.status === 'SIGNED'
          ? 'Signed'
          : recipient.status === 'DECLINED'
            ? 'Declined'
            : 'Pending';
      const eventDate = recipient.signedAt ?? recipient.declinedAt;

      page.drawText(`${recipient.name} <${recipient.email}> - ${recipient.roleName}`, {
        x: left,
        y,
        size: 11,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      y -= 16;

      const detailParts = [eventLabel];
      if (eventDate) detailParts.push(eventDate.toISOString());
      if (recipient.ipAddress) detailParts.push(`IP ${recipient.ipAddress}`);
      page.drawText(detailParts.join(' | '), {
        x: left,
        y,
        size: 9,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
      y -= 24;
    } catch (error) {
      console.error('appendCertificate: failed to draw a recipient row, using fallback', error);
      page.drawText('[Recipient details omitted - unsupported characters]', {
        x: left,
        y,
        size: 9,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
      y -= 24;
    }
  }

  y -= 10;
  page.drawText(`Audit trail: ${input.chainSummary}`, {
    x: left,
    y,
    size: 9,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
