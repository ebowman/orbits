/**
 * Pure geometry helpers for the 3D scene (no three.js, jsdom/node safe).
 * All outputs are in ECLIPTIC J2000 coordinates, AU.
 */
import {
  elementsToState,
  equatorialToEcliptic,
  rotateX,
  rotateZ,
  type OrbitalElements,
  type Vec3,
} from '@astro';

/** Max heliocentric distance (AU) drawn for hyperbolic arcs. */
export const HYPERBOLA_MAX_R = 60;

/** Equatorial J2000 vector -> ecliptic J2000 vector (display frame). */
export const toDisplay = (vEquatorial: Vec3): Vec3 => equatorialToEcliptic(vEquatorial);

/** Heliocentric position in ecliptic coordinates at jdTt. */
export function bodyPositionEcliptic(el: OrbitalElements, jdTt: number): Vec3 {
  return toDisplay(elementsToState(el, jdTt).r);
}

const perifocalToEcliptic = (p: Vec3, el: OrbitalElements): Vec3 =>
  rotateZ(rotateX(rotateZ(p, el.omega), el.i), el.Omega);

/**
 * Polyline of the orbit in ecliptic coordinates.
 * Ellipse: n points uniform in eccentric anomaly, last point === first (closed).
 * Hyperbola: n points uniform in H over the arc |nu| < nu_max - 0.05 (also capped at HYPERBOLA_MAX_R).
 */
export function sampleOrbit(el: OrbitalElements, n = 512): Vec3[] {
  const { a, e } = el;
  if (!(n >= 2)) throw new Error('sampleOrbit: n must be >= 2');
  if (e === 1 || !Number.isFinite(a) || a === 0) throw new Error('sampleOrbit: parabolic/degenerate orbit not supported');
  const pts: Vec3[] = [];
  if (e < 1) {
    const b = a * Math.sqrt(1 - e * e);
    for (let k = 0; k < n; k++) {
      const E = k === n - 1 ? 0 : (2 * Math.PI * k) / (n - 1);
      pts.push(perifocalToEcliptic([a * (Math.cos(E) - e), b * Math.sin(E), 0], el));
    }
    return pts;
  }
  const nuMax = Math.acos(-1 / e) - 0.05;
  const hNu = 2 * Math.atanh(Math.tan(nuMax / 2) / Math.sqrt((e + 1) / (e - 1)));
  // r = a(1 - e cosh H) with a < 0  =>  cosh H = (1 + r/|a|)/e... solve for cap
  const hR = Math.acosh((1 + HYPERBOLA_MAX_R / -a) / e);
  const hMax = Math.min(hNu, Number.isFinite(hR) ? hR : hNu);
  const bb = -a * Math.sqrt(e * e - 1);
  for (let k = 0; k < n; k++) {
    const H = -hMax + (2 * hMax * k) / (n - 1);
    pts.push(perifocalToEcliptic([a * (Math.cosh(H) - e), bb * Math.sinh(H), 0], el));
  }
  return pts;
}

