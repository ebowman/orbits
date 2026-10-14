import { describe, it, expect } from 'vitest';
import { gauss } from './gauss';
import type { IODInput, Observation } from './types';
import { loadCatalog } from '../catalog';
import { predict, type EphemerisBody } from '../ephemeris';
import type { OrbitalElements } from '../elements';
import { elementsToState, stateToElements } from '../state';
import { jdUtcToTt } from '../time';
import { dot, norm, unit, scale } from '../vec';
import { radecToUnit } from '../frames';
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
  'observer-positions',
  'time-intervals',
  'd-scalars',
  'polynomial',
  'roots',
  'slant-ranges',
  'initial-orbit',
  'final-state',
  'elements',
];

describe('gauss IOD, noiseless synthetic data', () => {
  for (const b of BODIES) {
    const el = elementsOf(b.id);
    const start = bestStart(el);
    for (const kind of ['geocentric', 'topocentric'] as const) {
      it(`${b.name} ${kind} recovers catalog elements`, () => {
        const site = kind === 'topocentric' ? SITE : null;
        const res = gauss(synth(el, start, site));
        expect(res.converged).toBe(true);
        const truth = stateToElements(
          elementsToState(el, res.jdTt2).r,
          elementsToState(el, res.jdTt2).v,
          res.jdTt2,
        ).elements;
        const got = res.elements;
        const errA = Math.abs(got.a - truth.a) / truth.a;
        const errE = Math.abs(got.e - truth.e);
        const errAng = [
          angDiff(got.i, truth.i),
          angDiff(got.Omega, truth.Omega),
          angDiff(got.omega, truth.omega),
          angDiff(got.M0, truth.M0),
        ];
        console.info(
          `${b.name} ${kind}: start JD ${start} elong ${(elongation(el, start) * 180 / Math.PI).toFixed(1)} deg, ` +
            `iters ${res.iterations}, a rel ${errA.toExponential(2)}, e ${errE.toExponential(2)}, ` +
            `angles ${errAng.map((x) => x.toExponential(2)).join(' ')}, roots ${res.rootsConsidered.length}`,
        );
        expect(errA).toBeLessThan(1e-6);
        expect(errE).toBeLessThan(1e-6);
        for (const x of errAng) expect(x).toBeLessThan(1e-5);
        expect(got.epochJd).toBe(res.jdTt2);
        expect(res.method).toBe('gauss');
        expect(res.rootsConsidered).toContain(res.chosenRoot);
        // Chosen root is the heliocentric distance of the middle observation.
        expect(Math.abs(norm(res.r2) - res.chosenRoot) / res.chosenRoot).toBeLessThan(0.05);
        // Trace contains every documented step id.
        const ids = res.trace.map((t) => t.id);
        for (const id of STEP_IDS) expect(ids).toContain(id);
        expect(ids.some((id) => /^iteration-\d+$/.test(id))).toBe(true);
        const it1 = res.trace.find((t) => t.id === 'iteration-1');
        for (const key of ['rho', 'r1', 'r2', 'r3', 'f1', 'g1', 'f3', 'g3', 'y1', 'y3']) {
          expect(it1?.values).toHaveProperty(key);
        }
      });
    }
  }

  it('middle body time is light-time corrected', () => {
    const el = elementsOf('433');
    const start = bestStart(el);
    const obs = synth(el, start, null);
    const res = gauss(obs);
    const tt2 = jdUtcToTt(obs[1].jdUtc);
    expect(res.jdTt2).toBeLessThan(tt2);
    expect(tt2 - res.jdTt2).toBeLessThan(0.05);
  });

  it('caps stored iteration trace steps at 20', () => {
    const el = elementsOf('1');
    const res = gauss(synth(el, bestStart(el), null), { maxIter: 40, tol: -1, rootIndex: 2 });
    expect(res.converged).toBe(false);
    expect(res.warnings.join(' ')).toMatch(/did not converge/);
    expect(res.trace.filter((t) => t.id.startsWith('iteration-')).length).toBe(20);
  });

  it('rejects nearly coplanar line-of-sight geometry', () => {
    const base = 2461000.5;
    const mk = (dt: number, ra: number): Observation => ({ jdUtc: base + dt, raRad: ra, decRad: 0, site: null });
    expect(() => gauss([mk(0, 1.0), mk(10, 1.01), mk(20, 1.02)] as IODInput)).toThrow(
      'Observations are nearly coplanar with the Sun-observer geometry; choose different times',
    );
  });
});

describe('gauss IOD, 1 arcsec noise', () => {
  for (const b of BODIES) {
    it(`${b.name} semi-major axis within 2% for 5 seeds`, () => {
      const el = elementsOf(b.id);
      const start = bestStart(el);
      for (const seed of [1, 2, 3, 12345, 987654]) {
        const res = gauss(synth(el, start, SITE, gaussianNoise(ARCSEC, seed)));
        const truth = stateToElements(elementsToState(el, res.jdTt2).r, elementsToState(el, res.jdTt2).v, res.jdTt2).elements;
        const rel = Math.abs(res.elements.a - el.a) / el.a;
        console.info(
          `${b.name} noisy seed ${seed}: a rel ${rel.toExponential(2)}, e err ${Math.abs(res.elements.e - truth.e).toExponential(2)}, ` +
            `i err ${angDiff(res.elements.i, truth.i).toExponential(2)} rad, iters ${res.iterations}, converged ${res.converged}`,
        );
        expect(rel, `seed ${seed}`).toBeLessThan(0.02);
        expect(res.converged, `seed ${seed}`).toBe(true);
      }
    });
  }
});

describe('gauss IOD, regressions', () => {
  it('noisy Ceres (seed 12345) converges despite the light-time 2-cycle', () => {
    const el = elementsOf('1');
    const res = gauss(synth(el, bestStart(el), SITE, gaussianNoise(ARCSEC, 12345)));
    console.info(`ceres seed 12345: converged ${res.converged} in ${res.iterations}`);
    expect(res.converged).toBe(true);
  });

  function checkNoiseless(id: string, offset: number) {
    const el = elementsOf(id);
    const res = gauss(synth(el, bestStart(el) + offset, null));
    const t = elementsToState(el, res.jdTt2);
    const truth = stateToElements(t.r, t.v, res.jdTt2).elements;
    const got = res.elements;
    expect(res.converged).toBe(true);
    expect(Math.abs(got.a - truth.a) / truth.a).toBeLessThan(1e-6);
    expect(Math.abs(got.e - truth.e)).toBeLessThan(1e-6);
    for (const k of ['i', 'Omega', 'omega', 'M0'] as const) expect(angDiff(got[k], truth[k])).toBeLessThan(1e-5);
    return res;
  }

  it('noiseless Eros at +60 d converges and recovers the elements', () => {
    const res = checkNoiseless('433', 60);
    console.info(`eros +60: iterations ${res.iterations}`);
  });

  for (const off of [120, 200]) {
    it(`Eros +${off} d returns the true orbit or a descriptive error, never an Earth-coincident orbit`, () => {
      const el = elementsOf('433');
      const obs = synth(el, bestStart(el) + off, null);
      let res;
      try {
        res = gauss(obs);
      } catch (err) {
        expect((err as Error).message).toMatch(/no physically valid solution/);
        expect((err as Error).message).toMatch(/rejected:/);
        return;
      }
      const fin = res.trace.find((t) => t.id === 'final-state')?.values.rho as number[];
      for (const r of fin) expect(r).toBeGreaterThan(1e-4);
      const t = elementsToState(el, res.jdTt2);
      const truth = stateToElements(t.r, t.v, res.jdTt2).elements;
      expect(Math.abs(res.elements.a - truth.a) / truth.a).toBeLessThan(1e-6);
      expect(Math.abs(res.elements.e - truth.e)).toBeLessThan(1e-6);
      const roots = res.trace.find((t2) => t2.id === 'roots')?.values ?? {};
      expect(Object.keys(roots).some((k) => k.startsWith('status-'))).toBe(true);
    });
  }

  it('D0 threshold: warns on weak geometry', () => {
    const el = elementsOf('1');
    const res = gauss(synth(el, bestStart(el), null));
    expect(res.warnings.some((w) => w.startsWith('weak geometry'))).toBe(res.trace.length > 0 && Math.abs(res.trace.find((t) => t.id === 'd-scalars')?.values.D0 as number) < 1e-6);
  });
});
