export interface FieldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SIZE = 0.01;

function round(value: number, decimals: number = 15): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export function clampFieldRect(rect: FieldRect): FieldRect {
  let width = Math.max(MIN_SIZE, Math.min(1, rect.width));
  let height = Math.max(MIN_SIZE, Math.min(1, rect.height));
  let x = rect.x;
  let y = rect.y;

  // If x is within valid bounds [0, 1), keep it and adjust width
  // Otherwise, clamp x first, then keep width
  if (x >= 0 && x < 1) {
    width = Math.min(width, 1 - x);
  } else {
    x = Math.max(0, Math.min(x, 1 - width));
  }

  // If y is within valid bounds [0, 1), keep it and adjust height
  // Otherwise, clamp y first, then keep height
  if (y >= 0 && y < 1) {
    height = Math.min(height, 1 - y);
  } else {
    y = Math.max(0, Math.min(y, 1 - height));
  }

  return { x: round(x), y: round(y), width: round(width), height: round(height) };
}
