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
