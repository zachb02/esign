import { describe, expect, it } from 'vitest';
import { pickReassignmentRole } from './role-reassignment';

const roles = [
  { id: 'r1', order: 0 },
  { id: 'r2', order: 1 },
  { id: 'r3', order: 2 },
];

describe('pickReassignmentRole', () => {
  it('picks the next role by order after the deleted one', () => {
    expect(pickReassignmentRole(roles, 'r1')?.id).toBe('r2');
  });

  it('wraps to an earlier role if the deleted one was last by order', () => {
    expect(pickReassignmentRole(roles, 'r3')?.id).toBe('r2');
  });

  it('returns null when the deleted role is the only role', () => {
    expect(pickReassignmentRole([{ id: 'only', order: 0 }], 'only')).toBeNull();
  });

  it('returns null when the deleted role id is not found', () => {
    expect(pickReassignmentRole(roles, 'missing')).not.toBeNull();
  });
});
