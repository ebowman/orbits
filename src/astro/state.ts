/**
 * Elements <-> state vectors.
 *
 * elementsToState: elements (ecliptic J2000) -> {r, v} in J2000 EQUATORIAL (AU, AU/day).
 * stateToElements: equatorial r, v -> { elements, warnings }. Elements are ecliptic J2000
 * with epochJd = jdTt. `warnings` is an array of human-readable strings (empty when
 * nothing notable happened); it lives on the return value, not on OrbitalElements.
 * Warnings are emitted for near-parabolic orbits (|e-1| < 1e-8), where e/a are clamped
 * to stay finite and the result is best effort.
 */
import { GM_SUN } from './constants';
import { eclipticToEquatorial, equatorialToEcliptic } from './frames';
import { normalizeRad } from './angles';
import { meanMotion, type OrbitalElements } from './elements';
import { solveKeplerElliptic, solveKeplerHyperbolic } from './kepler';
import { cross, dot, norm, rotateX, rotateZ, scale, sub, type Vec3 } from './vec';

export type StateVector = { r: Vec3; v: Vec3 };

export function elementsToState(el: OrbitalElements, jdTt: number, mu: number = GM_SUN): StateVector {
  const { a, e } = el;
  if (e === 1 || !Number.isFinite(a) || a === 0) throw new Error('elementsToState: parabolic/degenerate orbit not supported');
  if ((e < 1) !== (a > 0)) throw new Error('elementsToState: inconsistent a and e (need a>0 for e<1, a<0 for e>1)');
  const n = meanMotion(a, mu);
  const M = el.M0 + n * (jdTt - el.epochJd);
  let rp: Vec3;
  let vp: Vec3;
  if (e < 1) {
    const E = solveKeplerElliptic(M, e);
    const cE = Math.cos(E);
    const sE = Math.sin(E);
    const b = Math.sqrt(1 - e * e);
    const f = (n * a) / (1 - e * cE);
    rp = [a * (cE - e), a * b * sE, 0];
    vp = [-f * sE, f * b * cE, 0];
  } else {
    const H = solveKeplerHyperbolic(M, e);
    const cH = Math.cosh(H);
    const sH = Math.sinh(H);
    const b = Math.sqrt(e * e - 1);
    const f = (n * a) / (e * cH - 1); // a < 0
    rp = [a * (cH - e), -a * b * sH, 0];
    vp = [f * sH, -f * b * cH, 0];
  }
  const rot = (p: Vec3): Vec3 =>
    eclipticToEquatorial(rotateZ(rotateX(rotateZ(p, el.omega), el.i), el.Omega));
  return { r: rot(rp), v: rot(vp) };
}

export type StateToElementsResult = { elements: OrbitalElements; warnings: string[] };

const CIRC_TOL = 1e-10;
const EQ_TOL = 1e-10;
const PARA_TOL = 1e-8;
const E_CLAMP = 1e-12;

export function stateToElements(
  rEq: Vec3,
  vEq: Vec3,
  jdTt: number,
  mu: number = GM_SUN,
): StateToElementsResult {
  const warnings: string[] = [];
  const r = equatorialToEcliptic(rEq);
  const v = equatorialToEcliptic(vEq);
  const rn = norm(r);
  const v2 = dot(v, v);
  const h = cross(r, v);
  const hn = norm(h);
  if (rn === 0 || hn === 0) throw new Error('stateToElements: degenerate (zero r or rectilinear) state');
  const hhat = scale(h, 1 / hn);
  const evec = scale(sub(scale(r, v2 - mu / rn), scale(v, dot(r, v))), 1 / mu);
  let e = norm(evec);
  const energy = v2 / 2 - mu / rn;
  const p = (hn * hn) / mu;

  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hn)));
  const equatorial = i < EQ_TOL || Math.PI - i < EQ_TOL;
  const circular = e < CIRC_TOL;

  // Near-parabolic handling: keep e off 1 so a stays finite.
  if (Math.abs(e - 1) < PARA_TOL) {
    warnings.push(`near-parabolic orbit (e=${e}); a and M0 are best-effort`);
  }
  const elliptic = energy < 0;
  if (elliptic) e = Math.min(e, 1 - E_CLAMP);
  else e = Math.max(e, 1 + E_CLAMP);
  let a = -mu / (2 * energy);
  if (!Number.isFinite(a) || Math.abs(e - 1) < PARA_TOL) a = p / (1 - e * e);

  // Node and angles.
  const nvec: Vec3 = [-h[1], h[0], 0];
  let Omega = 0;
  let omega = 0;
  let nu: number;
  if (!equatorial) {
    const nhat = scale(nvec, 1 / norm(nvec));
    Omega = Math.atan2(nvec[1], nvec[0]);
    if (circular) {
      // omega = 0; nu is argument of latitude measured from the node.
      nu = Math.atan2(dot(hhat, cross(nhat, r)), dot(nhat, r));
    } else {
      omega = Math.atan2(dot(hhat, cross(nhat, evec)), dot(nhat, evec));
      nu = Math.atan2(dot(hhat, cross(evec, r)), dot(evec, r));
    }
  } else {
    const sgn = h[2] >= 0 ? 1 : -1; // i = pi flips the in-plane sense
    if (circular) {
      nu = Math.atan2(sgn * r[1], r[0]); // true longitude
    } else {
      omega = Math.atan2(sgn * evec[1], evec[0]);
      nu = Math.atan2(dot(hhat, cross(evec, r)), dot(evec, r));
    }
  }

  let M0: number;
  if (elliptic) {
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    M0 = E - e * Math.sin(E);
  } else {
    const t = Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2);
    const H = 2 * Math.atanh(Math.max(-1 + 1e-16, Math.min(1 - 1e-16, t)));
    M0 = e * Math.sinh(H) - H;
  }
  if (elliptic) M0 = normalizeRad(M0);

  return {
    elements: {
      a,
      e,
      i,
      Omega: normalizeRad(Omega),
      omega: normalizeRad(omega),
      M0,
      epochJd: jdTt,
      frame: 'eclipticJ2000',
    },
    warnings,
  };
}

