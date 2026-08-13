'use client';

import { FIELD_TYPE_LABELS, ROLE_COLORS } from '@/lib/fields/field-defaults';
import type { FieldTypeValue, SignerRoleRecord } from './types';

const FIELD_TYPES: FieldTypeValue[] = ['SIGNATURE', 'INITIALS', 'DATE_SIGNED', 'TEXT', 'CHECKBOX'];

interface FieldPaletteProps {
  roles: SignerRoleRecord[];
  selectedRoleId: string | null;
  onSelectRole: (roleId: string) => void;
  onAddRole: () => void;
  onDragFieldType: (type: FieldTypeValue, event: React.DragEvent) => void;
}

export function FieldPalette({
  roles,
  selectedRoleId,
  onSelectRole,
  onAddRole,
  onDragFieldType,
}: FieldPaletteProps) {
  return (
    <div className="flex w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r p-4">
      <div>
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Fields</h2>
        <div className="flex flex-col gap-1">
          {FIELD_TYPES.map((type) => (
            <div
              key={type}
              draggable
              onDragStart={(event) => onDragFieldType(type, event)}
              className="cursor-grab rounded border px-3 py-2 text-sm hover:bg-neutral-50"
            >
              {FIELD_TYPE_LABELS[type]}
            </div>
          ))}
        </div>
      </div>
      <div>
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Signers</h2>
        <div className="flex flex-col gap-1">
          {roles.map((role) => (
            <button
              key={role.id}
              onClick={() => onSelectRole(role.id)}
              className={`flex items-center gap-2 rounded px-3 py-2 text-left text-sm ${
                selectedRoleId === role.id ? 'bg-neutral-100 font-medium' : 'hover:bg-neutral-50'
              }`}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: ROLE_COLORS[role.colorIndex % ROLE_COLORS.length] }}
              />
              {role.name}
            </button>
          ))}
          <button
            onClick={onAddRole}
            className="rounded px-3 py-2 text-left text-sm text-neutral-500 hover:bg-neutral-50"
          >
            + Add signer role
          </button>
        </div>
      </div>
    </div>
  );
}
