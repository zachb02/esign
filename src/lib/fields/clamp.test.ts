import { describe, expect, it } from 'vitest';
import { clampFieldRect } from './clamp';

describe('clampFieldRect', () => {
  it('leaves an in-bounds rect unchanged', () => {
    expect(clampFieldRect({ x: 0.1, y: 0.2, width: 0.25, height: 0.06 })).toEqual({
      x: 0.1,
      y: 0.2,
      width: 0.25,
      height: 0.06,
    });
  });

  it('clamps negative x/y to 0', () => {
    expect(clampFieldRect({ x: -0.5, y: -0.2, width: 0.2, height: 0.05 })).toEqual({
      x: 0,
      y: 0,
      width: 0.2,
      height: 0.05,
    });
  });

  it('clamps width/height so x + width and y + height never exceed 1', () => {
    expect(clampFieldRect({ x: 0.9, y: 0.95, width: 0.3, height: 0.3 })).toEqual({
      x: 0.9,
      y: 0.95,
      width: 0.1,
      height: 0.05,
    });
  });

  it('clamps x/y that are already >= 1 down to a valid position', () => {
    expect(clampFieldRect({ x: 1.5, y: 2, width: 0.2, height: 0.1 })).toEqual({
      x: 0.8,
      y: 0.9,
      width: 0.2,
      height: 0.1,
    });
  });

  it('clamps a width/height of 0 or negative up to a tiny positive minimum', () => {
    const result = clampFieldRect({ x: 0.1, y: 0.1, width: 0, height: -0.5 });
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });
});
