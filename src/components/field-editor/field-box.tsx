'use client';

import { useRef, useState } from 'react';
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
  const [draftPosition, setDraftPosition] = useState<{ x: number; y: number } | null>(null);
  const [draftSize, setDraftSize] = useState<{ width: number; height: number } | null>(null);

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
      setDraftPosition({
        x: dragState.current.fieldX + deltaX,
        y: dragState.current.fieldY + deltaY,
      });
    }

    function handleMouseUp(upEvent: MouseEvent) {
      if (dragState.current) {
        const deltaX = (upEvent.clientX - dragState.current.startX) / rect.width;
        const deltaY = (upEvent.clientY - dragState.current.startY) / rect.height;
        onMove(dragState.current.fieldX + deltaX, dragState.current.fieldY + deltaY);
      }
      dragState.current = null;
      setDraftPosition(null);
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
      setDraftSize({
        width: resizeState.current.width + deltaWidth,
        height: resizeState.current.height + deltaHeight,
      });
    }

    function handleMouseUp(upEvent: MouseEvent) {
      if (resizeState.current) {
        const deltaWidth = (upEvent.clientX - resizeState.current.startX) / rect.width;
        const deltaHeight = (upEvent.clientY - resizeState.current.startY) / rect.height;
        onResize(resizeState.current.width + deltaWidth, resizeState.current.height + deltaHeight);
      }
      resizeState.current = null;
      setDraftSize(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  const color = role ? ROLE_COLORS[role.colorIndex % ROLE_COLORS.length] : '#999999';
  const displayX = draftPosition ? draftPosition.x : field.x;
  const displayY = draftPosition ? draftPosition.y : field.y;
  const displayWidth = draftSize ? draftSize.width : field.width;
  const displayHeight = draftSize ? draftSize.height : field.height;

  return (
    <div
      onMouseDown={handleDragMouseDown}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      className="absolute flex cursor-move items-center justify-center overflow-hidden rounded border-2 text-[10px] font-medium"
      style={{
        left: `${displayX * 100}%`,
        top: `${displayY * 100}%`,
        width: `${displayWidth * 100}%`,
        height: `${displayHeight * 100}%`,
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
