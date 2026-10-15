export type Vec3 = [number, number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/** Unit vector; throws on the zero vector. */
export function unit(a: Vec3): Vec3 {
  const n = norm(a);
  if (n === 0) throw new Error('unit: cannot normalize the zero vector');
  return scale(a, 1 / n);
}

/** Rotate vector by angle (rad) about the X axis (right-handed, active rotation). */
export function rotateX(a: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [a[0], c * a[1] - s * a[2], s * a[1] + c * a[2]];
}

/** Rotate vector by angle (rad) about the Z axis (right-handed, active rotation). */
export function rotateZ(a: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * a[0] - s * a[1], s * a[0] + c * a[1], a[2]];
}
