import { GM_SUN } from './constants';

/**
 * Classical orbital elements, heliocentric, ecliptic J2000.
 * Angles in radians, a in AU (a < 0 for hyperbolic orbits, e > 1).
 * M0 is the mean anomaly at epochJd (a TT Julian date). For hyperbolic orbits
 * M0 is the hyperbolic mean anomaly (M = e sinh H - H).
 */
export type OrbitalElements = {
  a: number;
  e: number;
  i: number;
  Omega: number;
  omega: number;
  M0: number;
  epochJd: number;
  frame: 'eclipticJ2000';
};

/** Mean motion in rad/day (uses |a|, valid for elliptic and hyperbolic). mu in AU^3/day^2. */
export const meanMotion = (a: number, mu: number = GM_SUN): number => Math.sqrt(mu / Math.abs(a) ** 3);

/** Orbital period in days; Infinity for non-elliptic orbits (a <= 0 or e >= 1). */
export function periodDays(el: Pick<OrbitalElements, 'a' | 'e'>, mu: number = GM_SUN): number {
  if (el.a <= 0 || el.e >= 1) return Infinity;
  return (2 * Math.PI) / meanMotion(el.a, mu);
}

/** Perihelion distance q in AU: a(1-e), positive for both elliptic (a>0) and hyperbolic (a<0). */
export const perihelionQ = (el: Pick<OrbitalElements, 'a' | 'e'>): number => el.a * (1 - el.e);

/** Julian date (TT) of perihelion passage: epoch - M0/n. */
export function timeOfPerihelion(el: OrbitalElements, mu: number = GM_SUN): number {
  return el.epochJd - el.M0 / meanMotion(el.a, mu);
}
