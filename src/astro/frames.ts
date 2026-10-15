import { OBLIQUITY_J2000_RAD } from './constants';
import { normalizeRad } from './angles';
import { rotateX, type Vec3 } from './vec';

/** Ecliptic (J2000) -> equatorial (J2000) rotation. */
export const eclipticToEquatorial = (v: Vec3): Vec3 => rotateX(v, OBLIQUITY_J2000_RAD);

/** Equatorial (J2000) -> ecliptic (J2000) rotation. */
export const equatorialToEcliptic = (v: Vec3): Vec3 => rotateX(v, -OBLIQUITY_J2000_RAD);

/** Unit vector from RA/Dec (rad). */
export function radecToUnit(ra: number, dec: number): Vec3 {
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)];
}

/** RA in [0, 2π) and Dec from any non-zero vector. */
export function unitToRadec(v: Vec3): { ra: number; dec: number } {
  const r = Math.hypot(v[0], v[1], v[2]);
  if (r === 0) throw new Error('unitToRadec: zero vector');
  return { ra: normalizeRad(Math.atan2(v[1], v[0])), dec: Math.asin(Math.max(-1, Math.min(1, v[2] / r))) };
}
