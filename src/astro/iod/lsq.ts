/**
 * Batch least-squares differential correction of a two-body heliocentric state using ALL observations.
 *
 * Unknowns: the 6-vector state (r, v) at epoch `initial.jdTt` (J2000 equatorial, AU and AU/day).
 * Residuals: observed minus predicted (RA*cos(dec), Dec) per observation, predicted by
 * `predictFromState`, which shares light-time, observer (geocentre-corrected Earth, topocentric
 * site) and frame conventions with ephemeris.ts `predict`.
 *
 * Jacobian: central finite differences. Step sizes: position 1e-7 * |r| (AU), velocity 1e-6 * |v|
 * (AU/day). (Velocity is deliberately larger than 1e-9 relative: with |v| ~ 0.01 AU/day a 1e-9 step is
 * ~1e-11 AU/day, whose effect is near the light-time iteration noise floor.) Solver: Gauss-Newton on
 * column-scaled normal equations, with step halving whenever the cost does not decrease.
 *
 * Never throws on numeric trouble (non-finite or failing predictions give converged=false plus a
 * warning); throws only on invalid input (fewer than 3 observations, non-finite numbers).
 */
import type { OrbitalElements } from '../elements';
import { predictFromState } from '../ephemeris';
import { stateToElements } from '../state';
import { wrapRadSigned } from './lsqUtil';
import type { Vec3 } from '../vec';
import type { Observation } from './types';

const ARCSEC = 206264.80624709636;

export type LsqInitial = { r: Vec3; v: Vec3; jdTt: number };
export type LsqOptions = {
  /** Maximum Gauss-Newton iterations (default 20). */
  maxIter?: number;
  /** Convergence: largest relative parameter step (default 1e-10). */
  tol?: number;
  /** Per-observation weights (default all 1); applied to both RA and Dec of that observation. */
  weights?: number[];
};
export type LsqResidual = { raCosDecArcsec: number; decArcsec: number };
export type LsqResult = {
  state: { r: Vec3; v: Vec3 };
  /** Null only if even the final state cannot be converted to elements. */
  elements: OrbitalElements | null;
  jdTt: number;
  iterations: number;
  converged: boolean;
  /** sqrt(sum of squared residual components / (2N)), arcsec, unweighted. */
  rmsArcsec: number;
  residuals: LsqResidual[];
  /** 6x6 covariance of (r, v), AU and AU/day, scaled by s^2 = chi2/(2N-6); omitted when 2N <= 6. */
  covariance?: number[][];
  warnings: string[];
};

/** Residual vector [ra*cos(dec), dec] per observation in radians; null if any prediction fails. */
function residualVector(obs: Observation[], x: number[], jdTt: number): number[] | null {
  const r: Vec3 = [x[0]!, x[1]!, x[2]!];
  const v: Vec3 = [x[3]!, x[4]!, x[5]!];
  const out: number[] = [];
  try {
    for (const o of obs) {
      const p = predictFromState(r, v, jdTt, o.jdUtc, o.site);
      out.push(wrapRadSigned(o.raRad - p.raRad) * Math.cos(o.decRad), o.decRad - p.decRad);
    }
  } catch {
    return null;
  }
  return out.every(Number.isFinite) ? out : null;
}

const cost = (res: number[], w: number[]): number => res.reduce((s, q, k) => s + w[k >> 1]! * q * q, 0);

/** Solve A x = b (A n x n, SPD-ish) by Gaussian elimination with partial pivoting; null if singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i]![c]!) > Math.abs(M[p]![c]!)) p = i;
    if (!(Math.abs(M[p]![c]!) > 1e-300)) return null;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let i = c + 1; i < n; i++) {
      const f = M[i]![c]! / M[c]![c]!;
      for (let j = c; j <= n; j++) M[i]![j] = M[i]![j]! - f * M[c]![j]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i]![n]!;
    for (let j = i + 1; j < n; j++) s -= M[i]![j]! * x[j]!;
    x[i] = s / M[i]![i]!;
  }
  return x.every(Number.isFinite) ? x : null;
}

function invert(A: number[][]): number[][] | null {
  const n = A.length;
  const cols: number[][] = [];
  for (let c = 0; c < n; c++) {
    const e = new Array<number>(n).fill(0);
    e[c] = 1;
    const x = solve(A, e);
    if (!x) return null;
    cols.push(x);
  }
  return A.map((_, i) => cols.map((col) => col[i]!));
}

/** Central-difference Jacobian (rows = residual components, cols = 6 params), plus parameter scales. */
function jacobian(obs: Observation[], x: number[], jdTt: number, scales: number[]): number[][] | null {
  const m = obs.length * 2;
  const J: number[][] = Array.from({ length: m }, () => new Array<number>(6).fill(0));
  for (let k = 0; k < 6; k++) {
    const h = scales[k]! * (k < 3 ? 1e-7 : 1e-6);
    const xp = [...x];
    const xm = [...x];
    xp[k] = x[k]! + h;
    xm[k] = x[k]! - h;
    const rp = residualVector(obs, xp, jdTt);
    const rm = residualVector(obs, xm, jdTt);
    if (!rp || !rm) return null;
    // Residual = obs - pred, so d(residual)/dparam = -(rp - rm)/(2h).
    for (let i = 0; i < m; i++) J[i]![k] = -(rp[i]! - rm[i]!) / (2 * h);
  }
  return J;
}

export function differentialCorrection(obs: Observation[], initial: LsqInitial, opts: LsqOptions = {}): LsqResult {
  if (!Array.isArray(obs) || obs.length < 3) throw new Error('differentialCorrection: need at least 3 observations');
  for (const o of obs) {
    if (![o.jdUtc, o.raRad, o.decRad].every(Number.isFinite)) throw new Error('differentialCorrection: non-finite observation');
  }
  const x0 = [...initial.r, ...initial.v];
  if (!x0.every(Number.isFinite) || !Number.isFinite(initial.jdTt)) throw new Error('differentialCorrection: non-finite initial state');
  const maxIter = opts.maxIter ?? 20;
  const tol = opts.tol ?? 1e-10;
  const w = opts.weights ?? obs.map(() => 1);
  if (w.length !== obs.length || !w.every((q) => Number.isFinite(q) && q > 0)) {
    throw new Error('differentialCorrection: weights must be positive and one per observation');
  }
  const N = obs.length;
  const warnings: string[] = [];
  const jdTt = initial.jdTt;
  const rN = Math.hypot(x0[0]!, x0[1]!, x0[2]!);
  const vN = Math.hypot(x0[3]!, x0[4]!, x0[5]!);
  const scales = [rN, rN, rN, vN, vN, vN].map((s) => (s > 0 ? s : 1));

  let x = x0;
  let res = residualVector(obs, x, jdTt);
  let iterations = 0;
  let converged = false;
  if (!res) {
    warnings.push('Initial state could not be evaluated (non-finite or failing prediction); no correction attempted.');
  } else {
    let c = cost(res, w);
    for (let it = 0; it < maxIter; it++) {
      iterations = it + 1;
      const J = jacobian(obs, x, jdTt, scales);
      if (!J) {
        warnings.push('Jacobian could not be evaluated; stopping.');
        break;
      }
      // Column-scaled weighted normal equations: (S J^T W J S) y = S J^T W r, dx = S y.
      const m = res.length;
      const A: number[][] = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
      const g = new Array<number>(6).fill(0);
      for (let i = 0; i < m; i++) {
        const wi = w[i >> 1]!;
        for (let a = 0; a < 6; a++) {
          const ja = J[i]![a]! * scales[a]!;
          g[a]! += wi * ja * res[i]!;
          for (let b = 0; b < 6; b++) A[a]![b]! += wi * ja * J[i]![b]! * scales[b]!;
        }
      }
      const y = solve(A, g);
      if (!y) {
        warnings.push('Normal equations are singular; stopping.');
        break;
      }
      // Step halving until the cost decreases.
      let lambda = 1;
      let accepted: { x: number[]; res: number[]; c: number } | null = null;
      for (let h = 0; h < 30; h++) {
        const xn = x.map((q, k) => q + lambda * y[k]! * scales[k]!);
        const rn = residualVector(obs, xn, jdTt);
        if (rn) {
          const cn = cost(rn, w);
          if (cn <= c) {
            accepted = { x: xn, res: rn, c: cn };
            break;
          }
        }
        lambda /= 2;
      }
      const relStep = Math.max(...y.map((q) => Math.abs(q * lambda)));
      if (!accepted) {
        // No decrease possible: at the cost floor (numerical noise) if the full step was already tiny.
        if (relStep < 1e-6 || Math.sqrt(c / (2 * N)) * ARCSEC < 1e-6) converged = true;
        else warnings.push('Step halving failed to reduce the residuals; stopping.');
        break;
      }
      x = accepted.x;
      res = accepted.res;
      c = accepted.c;
      if (relStep < tol) {
        converged = true;
        break;
      }
    }
    if (!converged && iterations >= maxIter) warnings.push(`Did not converge within ${maxIter} iterations.`);
  }

  const finalRes = res ?? new Array<number>(2 * N).fill(NaN);
  const rms = Math.sqrt(finalRes.reduce((s, q) => s + q * q, 0) / (2 * N)) * ARCSEC;
  const state = { r: [x[0]!, x[1]!, x[2]!] as Vec3, v: [x[3]!, x[4]!, x[5]!] as Vec3 };
  let elements: OrbitalElements | null = null;
  try {
    const conv = stateToElements(state.r, state.v, jdTt);
    elements = conv.elements;
    warnings.push(...conv.warnings);
  } catch {
    warnings.push('Final state could not be converted to orbital elements.');
  }
  if (converged && rms > 30) warnings.push(`Converged to a poor fit (RMS ${rms.toFixed(1)} arcsec); the initial guess may be in the wrong basin.`);

  const out: LsqResult = {
    state,
    elements,
    jdTt,
    iterations,
    converged: converged && res !== null,
    rmsArcsec: rms,
    residuals: Array.from({ length: N }, (_, n) => ({
      raCosDecArcsec: finalRes[2 * n]! * ARCSEC,
      decArcsec: finalRes[2 * n + 1]! * ARCSEC,
    })),
    warnings,
  };
  if (res && 2 * N > 6) {
    const J = jacobian(obs, x, jdTt, scales);
    if (J) {
      const A: number[][] = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
      for (let i = 0; i < J.length; i++) {
        for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) A[a]![b]! += w[i >> 1]! * J[i]![a]! * J[i]![b]!;
      }
      const inv = invert(A);
      if (inv) {
        const s2 = cost(res, w) / (2 * N - 6);
        out.covariance = inv.map((row) => row.map((q) => q * s2));
      }
    }
  }
  return out;
}
