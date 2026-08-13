import type { FieldType } from '@prisma/client';

export const DEFAULT_FIELD_SIZE: Record<FieldType, { width: number; height: number }> = {
  SIGNATURE: { width: 0.25, height: 0.06 },
  INITIALS: { width: 0.1, height: 0.06 },
  DATE_SIGNED: { width: 0.15, height: 0.04 },
  TEXT: { width: 0.2, height: 0.04 },
  CHECKBOX: { width: 0.03, height: 0.03 },
};

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  SIGNATURE: 'Signature',
  INITIALS: 'Initials',
  DATE_SIGNED: 'Date Signed',
  TEXT: 'Text',
  CHECKBOX: 'Checkbox',
};

export const ROLE_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#d97706',
  '#9333ea',
  '#0891b2',
  '#db2777',
  '#65a30d',
];

export function getRoleColor(index: number): string {
  return ROLE_COLORS[index % ROLE_COLORS.length];
}
