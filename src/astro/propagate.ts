/**
 * Universal-variable two-body propagation (Stumpff functions, Laguerre-Conway solver).
 * Units: positions AU, time days, mu AU^3/day^2. Frame-agnostic.
 */
import { GM_SUN } from './constants';
import { dot, norm, scale, add, type Vec3 } from './vec';

/** Stumpff functions C(z), S(z). Series for small |z| (always for |z| < 1e-6, and up to 0.5 for accuracy). */
export function stumpff(z: number): { C: number; S: number } {
  if (Math.abs(z) < 0.5) {
    let C = 0;
    let S = 0;
    let term = 1; // z^k
    let fC = 1; // (2k+2)!
    let fS = 1; // (2k+3)!
    for (let k = 0; k < 14; k++) {
      if (k > 0) term *= -z;
      if (k > 0) {
        fC *= (2 * k + 1) * (2 * k + 2);
        fS *= (2 * k + 2) * (2 * k + 3);
      } else {
        fC = 2;
        fS = 6;
      }
      C += term / fC;
      S += term / fS;
    }
    return { C, S };
  }
  if (z > 0) {
    const s = Math.sqrt(z);
    return { C: (1 - Math.cos(s)) / z, S: (s - Math.sin(s)) / (s * s * s) };
  }
  const s = Math.sqrt(-z);
  return { C: (Math.cosh(s) - 1) / -z, S: (Math.sinh(s) - s) / (s * s * s) };
}

type Solved = { chi: number; z: number; C: number; S: number; r: number; dt: number; r0: number; sqmu: number };

function solveUniversal(r0v: Vec3, v0v: Vec3, dtIn: number, mu: number): Solved {
  const r0 = norm(r0v);
  const v2 = dot(v0v, v0v);
  const sqmu = Math.sqrt(mu);
  const alpha = 2 / r0 - v2 / mu; // 1/a
  const sigma = dot(r0v, v0v) / sqmu; // r0 vr0 / sqrt(mu)
  let dt = dtIn;
  if (alpha > 1e-12) {
    // Elliptic: reduce by whole periods (exact; keeps z bounded).
    const period = (2 * Math.PI) / Math.sqrt(mu * alpha * alpha * alpha);
    dt = dtIn - period * Math.trunc(dtIn / period);
  }
  if (dt === 0) return { chi: 0, z: 0, C: 0.5, S: 1 / 6, r: r0, dt: 0, r0, sqmu };
  const k = 1 - alpha * r0;
  let chi: number;
  if (alpha > 1e-12) chi = sqmu * alpha * dt;
  else if (alpha < -1e-12) {
    const a = 1 / alpha;
    const sg = dt < 0 ? -1 : 1;
    const arg = (-2 * mu * alpha * dt) / (dot(r0v, v0v) + sg * Math.sqrt(-mu * a) * k);
    chi = arg > 0 && Number.isFinite(arg) ? sg * Math.sqrt(-a) * Math.log(arg) : (sqmu * dt) / r0;
  } else chi = (sqmu * dt) / r0;

  const n = 5;
  for (let it = 0; it < 200; it++) {
    const z = alpha * chi * chi;
    const { C, S } = stumpff(z);
    const F = sigma * chi * chi * C + k * chi ** 3 * S + r0 * chi - sqmu * dt;
    const F1 = sigma * chi * (1 - z * S) + k * chi * chi * C + r0;
    const F2 = sigma * (1 - z * C) + k * chi * (1 - z * S);
    const disc = Math.abs((n - 1) ** 2 * F1 * F1 - n * (n - 1) * F * F2);
    const den = F1 + (F1 >= 0 ? 1 : -1) * Math.sqrt(disc);
    const step = den === 0 ? F / F1 : (n * F) / den;
    chi -= step;
    if (Math.abs(step) < 1e-14 * Math.max(1, Math.abs(chi))) {
      const zz = alpha * chi * chi;
      const sc = stumpff(zz);
      const r = sigma * chi * (1 - zz * sc.S) + k * chi * chi * sc.C + r0;
      return { chi, z: zz, C: sc.C, S: sc.S, r, dt, r0, sqmu };
    }
  }
  throw new Error('propagate: universal-variable solver did not converge');
}

export type LagrangeFG = { f: number; g: number; fdot: number; gdot: number };

/** Lagrange f, g, fdot, gdot coefficients for a step of dt days. Works for negative dt. */
export function lagrangeFG(r0: Vec3, v0: Vec3, dt: number, mu: number = GM_SUN): LagrangeFG {
  const s = solveUniversal(r0, v0, dt, mu);
  const { chi, z, C, S, r, r0: rr0, sqmu } = s;
  return {
    f: 1 - (chi * chi * C) / rr0,
    g: s.dt - (chi ** 3 * S) / sqmu,
    fdot: (sqmu / (r * rr0)) * chi * (z * S - 1),
    gdot: 1 - (chi * chi * C) / r,
  };
}

/** Propagate a state (r0, v0) forward (or backward) by dtDays under central mass mu. */
export function propagate(r0: Vec3, v0: Vec3, dtDays: number, mu: number = GM_SUN): { r: Vec3; v: Vec3 } {
  const { f, g, fdot, gdot } = lagrangeFG(r0, v0, dtDays, mu);
  return { r: add(scale(r0, f), scale(v0, g)), v: add(scale(r0, fdot), scale(v0, gdot)) };
}
