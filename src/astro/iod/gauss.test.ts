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

  // Geocentric, RA = 0, 0.01, 0.02 rad, dec = 0, h, 0. With unit vectors (cos d cos a, cos d sin a, sin d),
  // D0 = L1 . (L2 x L3) expands by hand to ~ -0.02 h (to first order in the small angles).
  const mkD0 = (h: number): IODInput => {
    const mk = (dt: number, ra: number, dec: number): Observation => ({ jdUtc: 2461000.5 + dt, raRad: ra, decRad: dec, site: null });
    return [mk(0, 0, 0), mk(10, 0.01, h), mk(20, 0.02, 0)];
  };
  const handD0 = (h: number): number => {
    const u = (ra: number, dec: number): number[] => [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
    const a = u(0, 0);
    const b = u(0.01, h);
    const c = u(0.02, 0);
    return (
      a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) - a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) + a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!)
    );
  };

  it('D0 threshold: warns on weak geometry (1e-8 < |D0| < 1e-6)', () => {
    const h = 5e-6;
    const expected = -0.02 * h; // independent first-order hand value, -1e-7
    expect(Math.abs(handD0(h) - expected) / Math.abs(expected)).toBeLessThan(1e-2);
    // The default policy finds no valid root for this contrived geometry; rootIndex forces a result.
    const res = gauss(mkD0(h), { rootIndex: 0 });
    const warn = res.warnings.find((w) => w.startsWith('weak geometry: D0='));
    expect(warn).toBeDefined();
    const reported = Number(warn!.slice('weak geometry: D0='.length));
    expect(Math.abs(reported - expected) / Math.abs(expected)).toBeLessThan(1e-2);
  });

  it('D0 threshold: no weak-geometry warning for well-conditioned geometry', () => {
    const el = elementsOf('1');
    const res = gauss(synth(el, bestStart(el), null));
    expect(res.warnings.some((w) => w.startsWith('weak geometry'))).toBe(false);
  });

  it('D0 threshold: throws when |D0| < 1e-8', () => {
    const h = 2.5e-7;
    const expected = -0.02 * h; // -5e-9
    expect(Math.abs(handD0(h) - expected) / Math.abs(expected)).toBeLessThan(1e-2);
    expect(() => gauss(mkD0(h), { rootIndex: 0 })).toThrow(
      'Observations are nearly coplanar with the Sun-observer geometry; choose different times',
    );
  });

  it('explicit rootIndex for a rejected root returns a result with a rejection warning', () => {
    // Ceres at its catalog epoch: root 0 (r2 ~ 1.0123 AU) is Earth-coincident, rho2 < 1e-4 AU.
    const el = elementsOf('1');
    const obs = synth(el, el.epochJd, null);
    expect(() => gauss(obs)).not.toThrow(); // the default policy picks a valid root
    const dflt = gauss(obs);
    expect(dflt.warnings.some((w) => w.includes('would normally be rejected'))).toBe(false);
    const res = gauss(obs, { rootIndex: 0 });
    expect(res.chosenRoot).toBe(res.rootsConsidered[0]);
    expect(res.chosenRoot).not.toBe(dflt.chosenRoot);
    const w = res.warnings.find((x) => x.startsWith('The requested root '));
    expect(w).toBeDefined();
    expect(w).toMatch(/would normally be rejected: initial rho2 = .* is below 0\.0001 AU/);
    expect(w).toContain(res.chosenRoot.toFixed(4));
  });

  it('stops at the numerical noise floor: converged=true plus warning', () => {
    // tol = 0 can never be met by the relative test, so only the noise-floor stop can end the loop early.
    const el = elementsOf('1');
    const res = gauss(synth(el, el.epochJd, null), { tol: 0, rootIndex: 1 });
    expect(res.converged).toBe(true);
    expect(res.iterations).toBeLessThan(50);
    const w = res.warnings.find((x) => x.startsWith('Iteration stopped at the numerical noise floor'));
    expect(w).toBeDefined();
    expect(w).toMatch(/change in rho [0-9.]+e-\d+ AU\) rather than reaching 0\./);
    expect(res.warnings.some((x) => x.includes('did not converge'))).toBe(false);
  });

  it('rejects malformed observerPositions with a descriptive error', () => {
    const el = elementsOf('1');
    const obs = synth(el, el.epochJd, null);
    const v: [number, number, number] = [1, 0, 0];
    expect(() => gauss(obs, { observerPositions: [v, v] as never })).toThrow(/observerPositions must contain exactly 3/);
    expect(() => gauss(obs, { observerPositions: [v, v, v, v] as never })).toThrow(/observerPositions/);
    expect(() => gauss(obs, { observerPositions: [v, v, [1, NaN, 0]] as never })).toThrow(/finite/);
    expect(() => gauss(obs, { observerPositions: [v, v, [1, 0] as never] })).toThrow(/3-vector/);
  });
});

describe('gauss IOD, legitimate close approaches (Earth-coincident criterion)', () => {
  for (const c of CLOSE_APPROACH_CASES) {
    it(`solves by default: rho2 = ${c.rho2} AU at ${c.kms} km/s (${c.dir}, dt = ${c.spacing} d)`, () => {
      const { obs, el, jdTt2 } = closeApproach(c);
      const res = gauss(obs);
      const truth = trueElementsAt(el, jdTt2);
      expect(Math.abs(res.elements.a - truth.a) / truth.a).toBeLessThan(1e-4);
    });
  }

  it('still rejects the Eros +200 d spurious Earth-coincident root', () => {
    const el = elementsOf('433');
    const obs = synth(el, bestStart(el) + 200, null);
    let res;
    try {
      res = gauss(obs);
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
