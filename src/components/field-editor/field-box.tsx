'use client';

import { useRef } from 'react';
import { FIELD_TYPE_LABELS, ROLE_COLORS } from '@/lib/fields/field-defaults';
import type { FieldRecord, SignerRoleRecord } from './types';

interface FieldBoxProps {
  field: FieldRecord;
  role: SignerRoleRecord | undefined;
  roles: SignerRoleRecord[];
  isSelected: boolean;
  onSelect: () => void;
  onMove: (nextX: number, nextY: number) => void;
  onResize: (nextWidth: number, nextHeight: number) => void;
  onReassignRole: (roleId: string) => void;
  onToggleRequired: () => void;
  onDelete: () => void;
}

export function FieldBox({
  field,
  role,
  roles,
  isSelected,
  onSelect,
  onMove,
  onResize,
  onReassignRole,
  onToggleRequired,
  onDelete,
}: FieldBoxProps) {
  const dragState = useRef<{ startX: number; startY: number; fieldX: number; fieldY: number } | null>(
    null
  );
  const resizeState = useRef<{ startX: number; startY: number; width: number; height: number } | null>(
    null
  );

  function handleDragMouseDown(event: React.MouseEvent) {
    event.stopPropagation();
    onSelect();
    const container = (event.currentTarget as HTMLElement).closest('[data-page-surface]');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    dragState.current = {
      startX: event.clientX,
      startY: event.clientY,
      fieldX: field.x,
      fieldY: field.y,
    };

    function handleMouseMove(moveEvent: MouseEvent) {
      if (!dragState.current) return;
      const deltaX = (moveEvent.clientX - dragState.current.startX) / rect.width;
      const deltaY = (moveEvent.clientY - dragState.current.startY) / rect.height;
      onMove(dragState.current.fieldX + deltaX, dragState.current.fieldY + deltaY);
    }

    function handleMouseUp() {
      dragState.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleResizeMouseDown(event: React.MouseEvent) {
    event.stopPropagation();
    const container = (event.currentTarget as HTMLElement).closest('[data-page-surface]');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    resizeState.current = {
      startX: event.clientX,
      startY: event.clientY,
      width: field.width,
      height: field.height,
    };

    function handleMouseMove(moveEvent: MouseEvent) {
      if (!resizeState.current) return;
      const deltaWidth = (moveEvent.clientX - resizeState.current.startX) / rect.width;
      const deltaHeight = (moveEvent.clientY - resizeState.current.startY) / rect.height;
      onResize(resizeState.current.width + deltaWidth, resizeState.current.height + deltaHeight);
    }

    function handleMouseUp() {
      resizeState.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  const color = role ? ROLE_COLORS[role.colorIndex % ROLE_COLORS.length] : '#999999';

  return (
    <div
      onMouseDown={handleDragMouseDown}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      className="absolute flex cursor-move items-center justify-center overflow-hidden rounded border-2 text-[10px] font-medium"
      style={{
        left: `${field.x * 100}%`,
        top: `${field.y * 100}%`,
        width: `${field.width * 100}%`,
        height: `${field.height * 100}%`,
        borderColor: color,
        backgroundColor: `${color}22`,
        color,
      }}
    >
      {FIELD_TYPE_LABELS[field.type]}
      <div
        onMouseDown={handleResizeMouseDown}
        className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize"
        style={{ backgroundColor: color }}
      />
      {isSelected && (
        <div
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className="absolute -top-9 left-0 flex items-center gap-2 rounded border bg-white px-2 py-1 text-neutral-800 shadow"
        >
          <select
            value={field.signerRoleId}
            onChange={(event) => onReassignRole(event.target.value)}
            className="text-xs"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={field.required} onChange={onToggleRequired} />
            Required
          </label>
          <button onClick={onDelete} className="text-xs text-red-600">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
