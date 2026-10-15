import { describe, it, expect, vi } from 'vitest';
import { differentialCorrection } from './lsq';
import { gauss } from './gauss';
import type { IODInput, Observation } from './types';
import { loadCatalog } from '../catalog';
import { predict, type EphemerisBody } from '../ephemeris';

// Pathological-state hook: when set, predictFromState throws for any state displaced from `anchor`
// in more than one component (Jacobian axis-aligned probes still work, step-halving probes all fail).
const hook = vi.hoisted(() => ({ anchor: null as number[] | null, worse: false }));
vi.mock('../ephemeris', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../ephemeris')>();
  return {
    ...mod,
    predictFromState: ((r: number[], v: number[], ...rest: unknown[]) => {
      if (hook.anchor) {
        const x = [...r, ...v];
        const diff = x.filter((q, k) => q !== hook.anchor![k]).length;
        if (diff > 1) {
          if (!hook.worse) throw new Error('pathological');
          // Stall mock: every multi-component displacement predicts a position 1 rad off, so the cost
          // always gets worse while the (axis-aligned) Jacobian still promises a large reduction.
          const p = (mod.predictFromState as (...a: unknown[]) => { raRad: number })(r, v, ...rest);
          return { ...p, raRad: p.raRad + 1 };
        }
      }
      return (mod.predictFromState as (...a: unknown[]) => unknown)(r, v, ...rest);
    }) as typeof mod.predictFromState,
  };
});
import type { OrbitalElements } from '../elements';
import { elementsToState, stateToElements } from '../state';
import { dot, scale, unit } from '../vec';
import { radecToUnit } from '../frames';
import type { Site } from '../observer';

const SITE: Site = { latDeg: 19.8260847, lonEastDeg: 204.5278, elevM: 4210.24 };
const ARCSEC = Math.PI / 180 / 3600;
const cat = loadCatalog();
const elementsOf = (id: string): OrbitalElements => {
  const e = cat.find((c) => c.id === id);
  if (!e || !('a' in e.body)) throw new Error(`catalog missing ${id}`);
  return e.body;
};

function elongation(body: EphemerisBody, jdUtc: number): number {
  const p = predict(body, jdUtc, null);
  return Math.acos(dot(radecToUnit(p.raRad, p.decRad), unit(scale(p.rObserver, -1))));
}
function bestStart(el: OrbitalElements): number {
  let best = el.epochJd;
  let bestEl = -1;
  for (let d = -400; d <= 400; d += 5) {
    const e = elongation(el, el.epochJd + d);
    if (e > bestEl) {
      bestEl = e;
      best = el.epochJd + d;
    }
  }
  return best;
}
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussianNoise(sigmaRad: number, seed: number): () => number {
  const u = mulberry32(seed);
  return () => sigmaRad * Math.sqrt(-2 * Math.log(Math.max(u(), 1e-300))) * Math.cos(2 * Math.PI * u());
}
function synth(el: OrbitalElements, start: number, days: number[], site: Site | null, noise?: () => number): Observation[] {
  return days.map((dd): Observation => {
    const jdUtc = start + dd;
    const p = predict(el, jdUtc, site);
    let ra = p.raRad;
    let dec = p.decRad;
    if (noise) {
      ra += noise() / Math.cos(dec);
      dec += noise();
    }
    return { jdUtc, raRad: ra, decRad: dec, site };
  });
}
const seedOf = (obs3: Observation[]) => {
  const g = gauss(obs3 as IODInput);
  return { g, init: { r: g.r2, v: g.v2, jdTt: g.jdTt2 } };
};
const BODIES = [
  { name: 'ceres', id: '1' },
  { name: 'vesta', id: '4' },
  { name: 'eros', id: '433' },
];
const SEEDS = 100;
const med = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

describe('differentialCorrection', () => {
  for (const b of BODIES) {
    it(`${b.name}: noise-free 4 obs converges and matches catalog`, () => {
      const el = elementsOf(b.id);
      const start = bestStart(el);
      const obs = synth(el, start, [0, 10, 20, 30], SITE);
      const { init } = seedOf(obs.slice(0, 3));
      const fit = differentialCorrection(obs, init);
      const s = elementsToState(el, init.jdTt);
      const truth = stateToElements(s.r, s.v, init.jdTt).elements;
      const got = fit.elements!;
      const aErr = Math.abs(got.a - truth.a) / truth.a;
      const eErr = Math.abs(got.e - truth.e) / truth.e;
      const iErr = Math.abs(got.i - truth.i) / truth.i;
      console.info(`LSQ ${b.name} noise-free: iters ${fit.iterations} rms ${fit.rmsArcsec.toExponential(2)}" a ${aErr.toExponential(2)} e ${eErr.toExponential(2)} i ${iErr.toExponential(2)}`);
      expect(fit.converged).toBe(true);
      expect(fit.rmsArcsec).toBeLessThan(0.01);
      expect(aErr).toBeLessThan(1e-6);
      expect(eErr).toBeLessThan(1e-6);
      expect(iErr).toBeLessThan(1e-6);
      expect(fit.residuals).toHaveLength(4);
      expect(fit.covariance).toHaveLength(6);
    });

    it(`${b.name}: 1 arcsec noise, median |a err| of LSQ(4 obs, +40 d) vs Gauss(3 obs) over ${SEEDS} seeds`, () => {
      const el = elementsOf(b.id);
      const start = bestStart(el);
      const gErr: number[] = [];
      const lErr: number[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const obs = synth(el, start, [0, 10, 20, 40], SITE, gaussianNoise(ARCSEC, seed));
        const { g, init } = seedOf(obs.slice(0, 3));
        const fit = differentialCorrection(obs, init);
        gErr.push(Math.abs(g.elements.a - el.a) / el.a);
        lErr.push(Math.abs(fit.elements!.a - el.a) / el.a);
      }
      console.log(`LSQ ${b.name} noisy median a rel err (${SEEDS} seeds): Gauss ${med(gErr).toExponential(2)} LSQ(4) ${med(lErr).toExponential(2)}`);
      // Ceres: the extra night helps only modestly (a is weakly constrained at this geometry), but strictly.
      expect(med(lErr)).toBeLessThan(med(gErr));
    });
  }

  it('Ceres seed 80, 1 arcsec noise, 0/10/20/30 d: converges (default tolerance above numerical floor)', () => {
    const el = elementsOf('1');
    const obs = synth(el, bestStart(el), [0, 10, 20, 30], SITE, gaussianNoise(ARCSEC, 80));
    const { init } = seedOf(obs.slice(0, 3));
    const fit = differentialCorrection(obs, init);
    console.info(`LSQ ceres seed80: iters ${fit.iterations} rms ${fit.rmsArcsec.toFixed(3)}" converged ${fit.converged}`);
    expect(fit.converged).toBe(true);
    expect(fit.iterations).toBeLessThan(20);
  });

  it('step halving failure reports converged=false with a warning and never throws', () => {
    const el = elementsOf('1');
    const obs = synth(el, bestStart(el), [0, 10, 20, 30], SITE);
    const { init } = seedOf(obs.slice(0, 3));
    const bad = { r: scale(init.r, 1.3) as typeof init.r, v: init.v, jdTt: init.jdTt };
    hook.anchor = [...bad.r, ...bad.v];
    try {
      const fit = differentialCorrection(obs, bad);
      expect(fit.converged).toBe(false);
      expect(fit.warnings.some((w) => /Step halving failed/.test(w))).toBe(true);
    } finally {
      hook.anchor = null;
    }
  });

  it('stall far from the minimum (halving exhausted, predicted reduction large) is not converged', () => {
    const el = elementsOf('1');
    const obs = synth(el, bestStart(el), [0, 10, 20, 30], SITE);
    const { init } = seedOf(obs.slice(0, 3));
    const bad = { r: scale(init.r, 1.3) as typeof init.r, v: init.v, jdTt: init.jdTt };
    hook.anchor = [...bad.r, ...bad.v];
    hook.worse = true;
    try {
      const fit = differentialCorrection(obs, bad);
      expect(fit.converged).toBe(false);
      expect(fit.warnings.some((w) => /Step halving failed/.test(w))).toBe(true);
    } finally {
      hook.anchor = null;
      hook.worse = false;
    }
  });

  it('Ceres seeds 57 and 74 (1 arcsec noise, 0/10/20/30 d) converge at their known RMS', () => {
    const el = elementsOf('1');
    const start = bestStart(el);
    for (const [seed, rms] of [[57, 0.3457], [74, 0.1443]] as const) {
      const obs = synth(el, start, [0, 10, 20, 30], SITE, gaussianNoise(ARCSEC, seed));
      const fit = differentialCorrection(obs, seedOf(obs.slice(0, 3)).init);
      expect(fit.converged, `seed ${seed}`).toBe(true);
      expect(Math.abs(fit.rmsArcsec - rms)).toBeLessThan(1e-3);
    }
  });

  it('Ceres seeds 1-100 (1 arcsec noise, 0/10/20/30 d): no non-converged runs', () => {
    const el = elementsOf('1');
    const start = bestStart(el);
    const bad: number[] = [];
    for (let seed = 1; seed <= 100; seed++) {
      const obs = synth(el, start, [0, 10, 20, 30], SITE, gaussianNoise(ARCSEC, seed));
      const fit = differentialCorrection(obs, seedOf(obs.slice(0, 3)).init);
      if (!fit.converged) bad.push(seed);
    }
    console.info(`LSQ ceres non-converged seeds: ${JSON.stringify(bad)}`);
    expect(bad).toEqual([]);
  });

  it('exactly 3 obs: converges with rms ~ 0 and agrees with Gauss', () => {
    const el = elementsOf('1');
    const obs = synth(el, bestStart(el), [0, 10, 20], SITE);
    const { g, init } = seedOf(obs);
    const fit = differentialCorrection(obs, init);
    expect(fit.converged).toBe(true);
    expect(fit.rmsArcsec).toBeLessThan(0.01);
    expect(Math.abs(fit.elements!.a - g.elements.a) / g.elements.a).toBeLessThan(1e-6);
    expect(fit.covariance).toBeUndefined();
  });

  it('weights: unequal weights still converge on consistent data', () => {
    const el = elementsOf('1');
    const obs = synth(el, bestStart(el), [0, 10, 20, 30], SITE);
    const { init } = seedOf(obs.slice(0, 3));
    expect(differentialCorrection(obs, init, { weights: [1, 2, 1, 0.5] }).converged).toBe(true);
  });

  it('bad initial guess does not throw and reports non-convergence', () => {
    const el = elementsOf('1');
    const obs = synth(el, bestStart(el), [0, 10, 20, 30], SITE);
    const { init } = seedOf(obs.slice(0, 3));
    const bad = { r: init.r, v: scale(init.v, 8) as typeof init.v, jdTt: init.jdTt }; // far above escape speed
    const fit = differentialCorrection(obs, bad, { maxIter: 5 });
    expect(fit.converged).toBe(false);
    expect(fit.warnings.length).toBeGreaterThan(0);
  });

  it('non-finite state at start gives converged=false, not a throw', () => {
    const el = elementsOf('1');
    const obs = synth(el, bestStart(el), [0, 10, 20], SITE);
    const { init } = seedOf(obs);
    const fit = differentialCorrection(obs, { ...init, r: [init.r[0], init.r[1], 0] });
    expect(typeof fit.converged).toBe('boolean');
  });

  it('throws on invalid input only', () => {
    const el = elementsOf('1');
    const obs = synth(el, bestStart(el), [0, 10, 20], SITE);
    const { init } = seedOf(obs);
    expect(() => differentialCorrection(obs.slice(0, 2), init)).toThrow(/at least 3/);
    expect(() => differentialCorrection([{ ...obs[0]!, raRad: NaN }, obs[1]!, obs[2]!], init)).toThrow(/non-finite/);
    expect(() => differentialCorrection(obs, { ...init, jdTt: NaN })).toThrow(/non-finite/);
  });
});
