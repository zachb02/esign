export type FieldOwnerType = 'template' | 'document';

export interface SignerRoleRecord {
  id: string;
  name: string;
  order: number;
  colorIndex: number;
}

export type FieldTypeValue = 'SIGNATURE' | 'INITIALS' | 'DATE_SIGNED' | 'TEXT' | 'CHECKBOX';

export interface FieldRecord {
  id: string;
  signerRoleId: string;
  type: FieldTypeValue;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  required: boolean;
  label: string | null;
}
