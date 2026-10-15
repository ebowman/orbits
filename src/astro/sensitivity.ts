/**
 * Noise / spacing sensitivity sweep for IOD methods (pure, deterministic for a given seed).
 *
 * Methods compared: Gauss (iterated), CLASSICAL Laplace (iterate:false) and, optionally,
 * Gauss's first approximation (trace step 'initial-orbit'). Iterated Laplace is NOT used:
 * it converges to the same fixed point as Gauss, so comparing them would show nothing.
 *
 * Error metric: relative semi-major axis error |a - a_true| / a_true. The semi-major axis
 * is constant under two-body motion, so a is compared directly (no propagation to a common
 * epoch is needed).
 */
import { dot, scale, unit } from './vec';
import { radecToUnit } from './frames';
import { predict } from './ephemeris';
import { gauss } from './iod/gauss';
import { laplace } from './iod/laplace';
import { stateToElements } from './state';
import { seededGaussian } from './random';
import type { IODInput, IODResult, Observation } from './iod/types';
import type { OrbitalElements } from './elements';
import type { Site } from './observer';

const ARCSEC = Math.PI / (180 * 3600);

export type Solver = (obs: IODInput) => IODResult;
export type Solvers = { gauss: Solver; laplace: Solver };

/** Default solvers: Gauss, classical (non-iterated) Laplace. Gauss's first approximation is read from the same Gauss run's trace. */
export const defaultSolvers: Solvers = {
  gauss: (obs) => gauss(obs),
  laplace: (obs) => laplace(obs, { iterate: false }),
};

export type SweepParams = {
  /** Elements of the true orbit (the catalog body). */
  el: OrbitalElements;
  startJd: number;
  /** Spacing between successive observations, days. */
  spacings: number[];
  /** Per-coordinate Gaussian noise sigma, arcseconds. */
  noiseArcsec: number[];
  trials: number;
  seed: number;
  site?: Site | null;
};

export type SweepCell = {
  spacing: number;
  noise: number;
  /** Median relative a error over successful trials; null when every trial failed. */
  gaussAErrMedian: number | null;
  laplaceAErrMedian: number | null;
  gaussFirstAErrMedian: number | null;
  gaussFailRate: number;
  laplaceFailRate: number;
  gaussFirstFailRate: number;
};

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Start date within +-400 d of the catalog epoch that maximises elongation (5-day scan). */
export function bestElongationStart(el: OrbitalElements): number {
  let best = el.epochJd;
  let bestEl = -1;
  for (let d = -400; d <= 400; d += 5) {
    const p = predict(el, el.epochJd + d, null);
    const e = Math.acos(dot(radecToUnit(p.raRad, p.decRad), unit(scale(p.rObserver, -1))));
    if (e > bestEl) {
      bestEl = e;
      best = el.epochJd + d;
    }
  }
  return best;
}

/** Semi-major axis of a result, or null if non-elliptic / non-finite. */
function validA(a: number, e: number): number | null {
  return Number.isFinite(a) && Number.isFinite(e) && e >= 0 && e < 1 && a > 0 ? a : null;
}

function aOfResult(r: IODResult): number | null {
  return validA(r.elements.a, r.elements.e);
}

function aOfFirst(r: IODResult): number | null {
  const step = r.trace.find((s) => s.id === 'initial-orbit');
  const r2 = step?.values.r2;
  const v2 = step?.values.v2;
  if (!Array.isArray(r2) || !Array.isArray(v2) || r2.length !== 3 || v2.length !== 3) return null;
  const el = stateToElements(r2 as [number, number, number], v2 as [number, number, number], r.jdTt2).elements;
  return validA(el.a, el.e);
}

/** Computes one grid cell (spacing index i, noise index j). Deterministic in (seed, spacing, noise) values, not grid position. */
export function sweepCell(p: SweepParams, i: number, j: number, solvers: Solvers = defaultSolvers): SweepCell {
  const spacing = p.spacings[i]!;
  const noise = p.noiseArcsec[j]!;
  const site = p.site ?? null;
  const truth = [0, 1, 2].map((k) => {
    const jd = p.startJd + k * spacing;
    return { jd, pred: predict(p.el, jd, site) };
  });
  // Seed from the cell's (spacing, noise) VALUES so a cell gives identical results regardless of grid layout.
  const sKey = Math.round(spacing * 1e6) | 0;
  const nKey = Math.round(noise * 1e6) | 0;
  const g = seededGaussian((Math.imul(p.seed | 0, 1000003) + Math.imul(sKey, 7919) + Math.imul(nKey ^ 0x9e3779b1, 104729)) >>> 0);
  const errs = { gauss: [] as number[], laplace: [] as number[], first: [] as number[] };
  const fails = { gauss: 0, laplace: 0, first: 0 };
  for (let t = 0; t < p.trials; t++) {
    const obs = truth.map(({ jd, pred }, k): Observation => {
      let ra = pred.raRad;
      let dec = pred.decRad;
      if (noise > 0) {
        ra += (g() * noise * ARCSEC) / Math.cos(pred.decRad);
        dec += g() * noise * ARCSEC;
      }
      ra = ((ra % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return { jdUtc: jd, raRad: ra, decRad: dec, site: site ? { ...site } : null, label: `sweep ${k + 1}` };
    }) as IODInput;
    const record = (key: 'gauss' | 'laplace' | 'first', a: number | null) => {
      if (a === null) fails[key]++;
      else errs[key].push(Math.abs(a - p.el.a) / p.el.a);
    };
    // One Gauss run per trial feeds both the iterated result and the first approximation.
    try {
      const r = solvers.gauss(obs);
      record('gauss', aOfResult(r));
      record('first', aOfFirst(r));
    } catch {
      fails.gauss++;
      fails.first++;
    }
    try {
      record('laplace', aOfResult(solvers.laplace(obs)));
    } catch {
      fails.laplace++;
    }
  }
  const n = Math.max(1, p.trials);
  return {
    spacing,
    noise,
    gaussAErrMedian: median(errs.gauss),
    laplaceAErrMedian: median(errs.laplace),
    gaussFirstAErrMedian: median(errs.first),
    gaussFailRate: fails.gauss / n,
    laplaceFailRate: fails.laplace / n,
    gaussFirstFailRate: fails.first / n,
  };
}

/** Full sweep; result is indexed [spacingIndex][noiseIndex]. */
export function sweep(
  p: SweepParams,
  opts: { solvers?: Solvers; onProgress?: (done: number, total: number) => void } = {},
): SweepCell[][] {
  const total = p.spacings.length * p.noiseArcsec.length;
  let done = 0;
  return p.spacings.map((_, i) =>
    p.noiseArcsec.map((_, j) => {
      const c = sweepCell(p, i, j, opts.solvers);
      opts.onProgress?.(++done, total);
      return c;
    }),
  );
}
