import { describe, it, expect } from 'vitest';
import { gauss } from './gauss';
import { laplace } from './laplace';
import type { IODInput, Observation } from './types';
import { loadCatalog } from '../catalog';
import { predict, type EphemerisBody } from '../ephemeris';
import type { OrbitalElements } from '../elements';
import { elementsToState, stateToElements } from '../state';
import { jdUtcToTt } from '../time';
import { dot, unit, scale } from '../vec';
import { radecToUnit } from '../frames';
import { CLOSE_APPROACH_CASES, closeApproach, trueElementsAt } from './closeApproachFixture';
import type { Site } from '../observer';

const SITE: Site = { latDeg: 19.8260847, lonEastDeg: 204.5278, elevM: 4210.24 };
const cat = loadCatalog();
const elementsOf = (id: string): OrbitalElements => {
  const e = cat.find((c) => c.id === id);
  if (!e || !('a' in e.body)) throw new Error(`catalog missing ${id}`);
  return e.body;
};
const BODIES = [
  { name: 'ceres', id: '1' },
  { name: 'vesta', id: '4' },
  { name: 'eros', id: '433' },
];

const angDiff = (x: number, y: number): number => {
  const d = (x - y) % (2 * Math.PI);
  return Math.abs(d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d);
};

/** Solar elongation (rad) of the body from the geocenter at jdUtc. */
function elongation(body: EphemerisBody, jdUtc: number): number {
  const p = predict(body, jdUtc, null);
  return Math.acos(dot(radecToUnit(p.raRad, p.decRad), unit(scale(p.rObserver, -1))));
}

/** Start date within +-400 d of the catalog epoch that maximises elongation (5-day scan). */
function bestStart(el: OrbitalElements): number {
  const epochUtc = el.epochJd; // TT ~ UTC to within ~70 s; fine for choosing a date
  let best = epochUtc;
  let bestEl = -1;
  for (let d = -400; d <= 400; d += 5) {
    const e = elongation(el, epochUtc + d);
    if (e > bestEl) {
      bestEl = e;
      best = epochUtc + d;
    }
  }
  return best;
}

function synth(el: OrbitalElements, start: number, site: Site | null, noise?: () => number): IODInput {
  return [0, 10, 20].map((dd): Observation => {
    const jdUtc = start + dd;
    const p = predict(el, jdUtc, site);
    let ra = p.raRad;
    let dec = p.decRad;
    if (noise) {
      ra += noise() / Math.cos(dec);
      dec += noise();
    }
    return { jdUtc, raRad: ra, decRad: dec, site };
  }) as IODInput;
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
  return () => {
    const a = Math.max(u(), 1e-300);
    return sigmaRad * Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u());
  };
}
const ARCSEC = Math.PI / 180 / 3600;

const STEP_IDS = [
  'los-vectors',
  'interpolation',
  'derivatives',
  'observer-state',
  'determinants',
  'polynomial',
  'roots',
  'rho-rhodot',
  'classical-result',
  'final-state',
  'elements',
];

function errs(res: { elements: OrbitalElements; jdTt2: number }, el: OrbitalElements) {
  const t = elementsToState(el, res.jdTt2);
  const truth = stateToElements(t.r, t.v, res.jdTt2).elements;
  const got = res.elements;
  return {
    a: Math.abs(got.a - truth.a) / truth.a,
    e: Math.abs(got.e - truth.e),
    ang: [angDiff(got.i, truth.i), angDiff(got.Omega, truth.Omega), angDiff(got.omega, truth.omega), angDiff(got.M0, truth.M0)],
  };
}

describe('laplace IOD, noiseless synthetic data', () => {
  for (const b of BODIES) {
    const el = elementsOf(b.id);
    const start = bestStart(el);
    for (const kind of ['geocentric', 'topocentric'] as const) {
      it(`${b.name} ${kind}: iterated recovers elements, classical is approximate`, () => {
        const site = kind === 'topocentric' ? SITE : null;
        const obs = synth(el, start, site);
        const res = laplace(obs);
        expect(res.converged).toBe(true);
        const er = errs(res, el);
        const cls = laplace(obs, { iterate: false });
        const ec = errs(cls, el);
        console.info(
          `${b.name} ${kind}: iterated iters ${res.iterations} a rel ${er.a.toExponential(2)}, e ${er.e.toExponential(2)}, ` +
            `angles ${er.ang.map((x) => x.toExponential(2)).join(' ')}; classical a rel ${ec.a.toExponential(2)}, e ${ec.e.toExponential(2)}, ` +
            `angles ${ec.ang.map((x) => x.toExponential(2)).join(' ')}; roots ${res.rootsConsidered.length}`,
        );
        expect(er.a).toBeLessThan(1e-5);
        expect(er.e).toBeLessThan(1e-5);
        for (const x of er.ang) expect(x).toBeLessThan(1e-4);
        expect(res.warnings.join(' ')).not.toMatch(/noise floor/);
        expect(res.method).toBe('laplace');
        expect(res.elements.epochJd).toBe(res.jdTt2);
        expect(res.rootsConsidered).toContain(res.chosenRoot);

        expect(cls.converged).toBe(true);
        expect(cls.iterations).toBe(0);
        expect(ec.a).toBeLessThan(0.05);

        const ids = res.trace.map((t) => t.id);
        for (const id of STEP_IDS) expect(ids).toContain(id);
        expect(ids.some((id) => /^iteration-\d+$/.test(id))).toBe(true);
        const it1 = res.trace.find((t) => t.id === 'iteration-1');
        for (const key of ['rho', 'r1', 'r2', 'r3', 'f1', 'g1', 'f3', 'g3']) expect(it1?.values).toHaveProperty(key);
        const classical = res.trace.find((t) => t.id === 'classical-result');
        expect(classical?.values.a).toBeCloseTo(cls.elements.a, 10);
        expect(cls.trace.map((t) => t.id).some((id) => id.startsWith('iteration-'))).toBe(false);
      });
    }
  }

  it('middle body time is light-time corrected', () => {
    const el = elementsOf('433');
    const obs = synth(el, bestStart(el), null);
    const res = laplace(obs);
    const tt2 = jdUtcToTt(obs[1].jdUtc);
    expect(res.jdTt2).toBeLessThan(tt2);
    expect(tt2 - res.jdTt2).toBeLessThan(0.05);
  });

  it('handles unequally spaced observations', () => {
    const el = elementsOf('433');
    const start = bestStart(el);
    const obs = [0, 7, 20].map((dd): Observation => {
      const p = predict(el, start + dd, null);
      return { jdUtc: start + dd, raRad: p.raRad, decRad: p.decRad, site: null };
    }) as IODInput;
    const res = laplace(obs);
    const er = errs(res, el);
    expect(res.converged).toBe(true);
    expect(er.a).toBeLessThan(1e-5);
    expect(er.e).toBeLessThan(1e-5);
  });

  it('caps stored iteration trace steps at 20', () => {
    const el = elementsOf('1');
    const obs = synth(el, bestStart(el), null);
    const rootIndex = laplace(obs).rootsConsidered.length - 1;
    const res = laplace(obs, { maxIter: 40, tol: -1, rootIndex });
    expect(res.converged).toBe(false);
    expect(res.warnings.join(' ')).toMatch(/did not converge/);
    expect(res.trace.filter((t) => t.id.startsWith('iteration-')).length).toBe(20);
  });

  it('records a status for every root and never returns an Earth-coincident orbit', () => {
    const el = elementsOf('433');
    const obs = synth(el, bestStart(el) + 120, null);
    let res;
    try {
      res = laplace(obs);
    } catch (err) {
      expect((err as Error).message).toMatch(/no physically valid solution/);
      expect((err as Error).message).toMatch(/rejected:/);
      return;
    }
    const roots = res.trace.find((t) => t.id === 'roots')?.values ?? {};
    expect(Object.keys(roots).some((k) => k.startsWith('status-'))).toBe(true);
    const fin = res.trace.find((t) => t.id === 'final-state')?.values.rho as number[];
    for (const r of fin) expect(r).toBeGreaterThan(1e-4);
  });

  it('rejects degenerate line-of-sight geometry', () => {
    const base = 2461000.5;
    const mk = (dt: number, ra: number): Observation => ({ jdUtc: base + dt, raRad: ra, decRad: 0, site: null });
    expect(() => laplace([mk(0, 1.0), mk(10, 1.01), mk(20, 1.02)] as IODInput)).toThrow();
  });
});

describe('laplace IOD, classical error vs spacing', () => {
  for (const b of BODIES) {
    it(`${b.name} classical a error shrinks with spacing, topocentric tracks geocentric`, () => {
      const el = elementsOf(b.id);
      const start = bestStart(el);
      const table: Record<string, number[]> = { geo: [], topo: [] };
      for (const sp of [20, 10, 4, 2]) {
        for (const [k, site] of [['geo', null], ['topo', SITE]] as const) {
          const obs = [0, sp, 2 * sp].map((dd): Observation => {
            const p = predict(el, start + dd, site);
            return { jdUtc: start + dd, raRad: p.raRad, decRad: p.decRad, site };
          }) as IODInput;
          table[k]!.push(errs(laplace(obs, { iterate: false }), el).a);
        }
      }
      console.info(
        `${b.name} classical a rel at 20/10/4/2 d: geo ${table.geo!.map((x) => x.toExponential(2)).join(' / ')}; ` +
          `topo ${table.topo!.map((x) => x.toExponential(2)).join(' / ')}`,
      );
      for (const k of ['geo', 'topo']) {
        const v = table[k]!;
        for (let i = 1; i < v.length; i++) expect(v[i]!, `${k} spacing index ${i}`).toBeLessThan(v[i - 1]!);
      }
      for (let i = 0; i < 4; i++) {
        const g = table.geo![i]!;
        const tp = table.topo![i]!;
        expect(tp / g, `spacing index ${i}`).toBeLessThan(3);
        expect(g / tp, `spacing index ${i}`).toBeLessThan(3);
      }
    });
  }
});

describe('laplace IOD, 1 arcsec noise', () => {
  for (const b of BODIES) {
    it(`${b.name} semi-major axis finite and within 20% for 5 seeds`, () => {
      const el = elementsOf(b.id);
      const start = bestStart(el);
      let conv = 0;
      for (const seed of [1, 2, 3, 12345, 987654]) {
        const obs = synth(el, start, SITE, gaussianNoise(ARCSEC, seed));
        const res = laplace(obs);
        const er = errs(res, el);
        const ra = Math.abs(res.elements.a - el.a) / el.a;
        let gtxt: string;
        try {
          const g = gauss(obs);
          const eg = errs(g, el);
          const ga = Math.abs(g.elements.a - el.a) / el.a;
          gtxt = `gauss a ${ga.toExponential(2)} e ${eg.e.toExponential(2)} i ${eg.ang[0]!.toExponential(2)} (a ratio laplace/gauss ${(ra / ga).toFixed(2)})`;
        } catch (err) {
          gtxt = `gauss threw ${(err as Error).message.slice(0, 60)}`;
        }
        if (res.converged) conv++;
        console.info(
          `${b.name} noisy seed ${seed}: laplace a ${ra.toExponential(2)} e ${er.e.toExponential(2)} i ${er.ang[0]!.toExponential(2)} ` +
            `iters ${res.iterations} converged ${res.converged}; ${gtxt}`,
        );
        expect(Number.isFinite(ra), `seed ${seed}`).toBe(true);
        expect(ra, `seed ${seed}`).toBeLessThan(0.2);
      }
      console.info(`${b.name}: laplace converged ${conv}/5`);
    });
  }
});

describe('laplace IOD, legitimate close approaches (Earth-coincident criterion)', () => {
  for (const c of CLOSE_APPROACH_CASES) {
    it(`solves by default: rho2 = ${c.rho2} AU at ${c.kms} km/s (${c.dir}, dt = ${c.spacing} d)`, () => {
      const { obs, el, jdTt2 } = closeApproach(c);
      const res = laplace(obs, { iterate: true });
      const truth = trueElementsAt(el, jdTt2);
      expect(Math.abs(res.elements.a - truth.a) / truth.a).toBeLessThan(1e-4);
    });
  }

  it('still rejects the Eros +200 d spurious Earth-coincident root', () => {
    const el = elementsOf('433');
    const obs = synth(el, bestStart(el) + 200, null);
    let res;
    try {
      res = laplace(obs, { iterate: true });
    } catch (err) {
      expect((err as Error).message).toMatch(/no physically valid solution/);
      expect((err as Error).message).toMatch(/Earth-coincident/);
      return;
    }
    // If a root survives it must be the true orbit, not the Earth-like a ~ 0.998 AU one.
    const t = elementsToState(el, res.jdTt2);
    const truth = stateToElements(t.r, t.v, res.jdTt2).elements;
    expect(Math.abs(res.elements.a - truth.a) / truth.a).toBeLessThan(1e-6);
  });
});
