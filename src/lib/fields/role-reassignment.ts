export interface RoleOrderRecord {
  id: string;
  order: number;
}

export function pickReassignmentRole<T extends RoleOrderRecord>(
  roles: T[],
  deletedRoleId: string
): T | null {
  const remaining = roles.filter((r) => r.id !== deletedRoleId);
  if (remaining.length === 0) return null;
  const sorted = [...remaining].sort((a, b) => a.order - b.order);
  const deleted = roles.find((r) => r.id === deletedRoleId);
  if (!deleted) return sorted[0];
  const next = sorted.find((r) => r.order > deleted.order);
  return next ?? sorted[sorted.length - 1];
}
