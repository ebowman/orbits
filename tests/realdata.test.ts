// ERROR BUDGET: e/i limits are looser than the noiseless synthetic tests because real data carries
// systematic line-of-sight errors that act like correlated observation errors:
//  - Earth position comes from the Standish approximate ephemeris, up to ~9e-5 AU off (planets.test.ts vs Horizons);
//  - predictor-vs-Horizons residuals are 6-14 arcsec (ephemeris.test.ts), larger than the 1 arcsec noise tests,
//    which already showed e errors up to ~1e-2 for Ceres.
// CONTROL (last describe): feeding Horizons Earth vectors instead of Standish for Ceres 10 d (Gauss/refined) drops
// errors a 2.8e-3 -> 4.4e-5 (rel), e 0.0150 -> 0.00019, i 0.137 -> 0.0014 deg; i.e. Standish Earth is the dominant term.
// Measured worst cases (Gauss/refined): Ceres 10 d e=0.0150, Eros i=0.147 deg. Hence e<0.03, i<0.35 deg
// (classical: e<0.05, i<0.5 deg); a stays <1% (classical <10%). The diagnostic test below shows the solver
// itself recovers Horizons elements to <1e-6 when fed our own predict() output.
// Real-data validation: Gauss and Laplace IOD on JPL Horizons astrometry (opposition windows).
// Truth = Horizons osculating elements at the triplet's middle epoch (fixtures *-opposition-elements.json),
// propagated two-body to the solver's light-time-corrected body time jdTt2 (a few hours at most).
// Site for 568 comes from the fixture (Horizons "Center geodetic" header = MPC obscode 568).
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gauss } from '../src/astro/iod/gauss';
import { laplace } from '../src/astro/iod/laplace';
import type { IODInput, IODResult, Observation } from '../src/astro/iod/types';
import type { OrbitalElements } from '../src/astro/elements';
import type { Site } from '../src/astro/observer';
import { elementsToState, stateToElements } from '../src/astro/state';
import { observerGeocentric } from '../src/astro/observer';
import { predict } from '../src/astro/ephemeris';
import { propagate } from '../src/astro/propagate';
import { DEG2RAD, RAD2DEG } from '../src/astro/angles';
import type { Vec3 } from '../src/astro/vec';

const dir = join(__dirname, 'fixtures', 'horizons');
type Row = { jdUtc: number; raDeg: number; decDeg: number };
type Fixture = { rows: Row[]; site?: Site | null };
type ElRow = { spacingDays: number; jdTdb: number; a: number; e: number; iDeg: number; OmegaDeg: number; omegaDeg: number; MDeg: number };
const load = <T>(f: string): T => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T;

const BODIES = [
  { name: 'ceres', tag: 'geocentric' },
  { name: 'vesta', tag: 'geocentric' },
  { name: 'eros', tag: '568' }, // NEO, large parallax: topocentric required
];
const SPACINGS: [number, number[]][] = [
  [10, [0, 10, 20]],
  [5, [0, 5, 10]],
];

function buildObs(fx: Fixture, days: number[]): IODInput {
  const site = fx.site ?? null;
  return days.map((d): Observation => {
    const r = fx.rows[d]!;
    return { jdUtc: r.jdUtc, raRad: r.raDeg * DEG2RAD, decRad: r.decDeg * DEG2RAD, site };
  }) as IODInput;
}

function truthAt(row: ElRow, jdTt: number): OrbitalElements {
  const epoch = row.jdTdb; // TDB ~ TT (< 2 ms)
  const el: OrbitalElements = {
    a: row.a, e: row.e, i: row.iDeg * DEG2RAD, Omega: row.OmegaDeg * DEG2RAD,
    omega: row.omegaDeg * DEG2RAD, M0: row.MDeg * DEG2RAD, epochJd: epoch, frame: 'eclipticJ2000',
  };
  const s = elementsToState(el, epoch);
  const p = propagate(s.r, s.v, jdTt - epoch);
  return stateToElements(p.r, p.v, jdTt).elements;
}

type Err = { aRel: number; e: number; iDeg: number };
const errs = (got: OrbitalElements, t: OrbitalElements): Err => ({
  aRel: Math.abs(got.a - t.a) / t.a,
  e: Math.abs(got.e - t.e),
  iDeg: Math.abs(got.i - t.i) * RAD2DEG,
});
type Tol = { a: number; e: number; i: number };
const TOL_REFINED: Tol = { a: 0.01, e: 0.03, i: 0.35 };
const TOL_CLASSICAL: Tol = { a: 0.1, e: 0.05, i: 0.5 };
const within = (x: Err, t: Tol): boolean => x.aRel < t.a && x.e < t.e && x.iDeg < t.i;

const summary: Record<string, string | number>[] = [];
const record = (body: string, fixture: string, spacing: number | string, method: string, x: Err | null, r: IODResult | null, note = '') =>
  summary.push({
    body, fixture, spacing, method,
    'a rel': x ? +x.aRel.toExponential(2) : NaN,
    e: x ? +x.e.toExponential(2) : NaN,
    'i deg': x ? +x.iDeg.toExponential(2) : NaN,
    converged: r ? String(r.converged) : 'n/a',
    warnings: r ? r.warnings.length : -1,
    note,
  });

afterAll(() => {
  console.table(summary);
});

/** Run a method with default root; if it misses tolerance and multiple roots exist, require ONE candidate to pass. */
function check(
  run: (rootIndex?: number) => IODResult,
  truthRow: ElRow,
  tol: Tol,
  label: string,
  body: string,
  fixture: string,
  spacing: number,
  method: string,
) {
  const def = run();
  const x = errs(def.elements, truthAt(truthRow, def.jdTt2));
  if (within(x, tol)) {
    record(body, fixture, spacing, method, x, def);
    expect(def.converged, label).toBe(true);
    return;
  }
  // Charlier-style ambiguity: look for any surviving candidate that meets tolerance.
  console.log(`${label}: default root ${def.chosenRoot} of [${def.rootsConsidered.map((v) => v.toPrecision(4))}] missed tolerance`, x);
  let found: { idx: number; x: Err; r: IODResult } | null = null;
  for (let k = 0; k < def.rootsConsidered.length; k++) {
    try {
      const r = run(k);
      const xk = errs(r.elements, truthAt(truthRow, r.jdTt2));
      if (within(xk, tol)) {
        found = { idx: k, x: xk, r };
        break;
      }
    } catch {
      /* candidate rejected */
    }
  }
  if (found) {
    console.log(`${label}: default pick was WRONG; rootIndex ${found.idx} meets tolerance`);
    record(body, fixture, spacing, method, found.x, found.r, `default root wrong; rootIndex ${found.idx}`);
    expect(found.r.converged, `${label} alternative root converged`).toBe(true);
    return;
  }
  record(body, fixture, spacing, method, x, def, 'TOLERANCE FAILED');
  expect(within(x, tol), `${label} default root errors ${JSON.stringify(x)}`).toBe(true);
}

describe('real-data IOD on Horizons opposition fixtures', () => {
  for (const b of BODIES) {
    const fx = load<Fixture>(`${b.name}-opposition-${b.tag}.json`);
    const els = load<{ rows: ElRow[] }>(`${b.name}-opposition-elements.json`);
    for (const [spacing, days] of SPACINGS) {
      const truthRow = els.rows.find((r) => r.spacingDays === spacing)!;
      const tag = `${b.name}/${b.tag}/${spacing}d`;
      const obs = buildObs(fx, days);

      it(`${tag} gauss`, () => {
        check((ri) => gauss(obs, { rootIndex: ri }), truthRow, TOL_REFINED, tag + ' gauss', b.name, b.tag, spacing, 'gauss');
      });
      it(`${tag} laplace refined`, () => {
        check((ri) => laplace(obs, { iterate: true, rootIndex: ri }), truthRow, TOL_REFINED, tag + ' laplace-refined', b.name, b.tag, spacing, 'laplace-refined');
      });
      it(`${tag} laplace classical`, () => {
        check((ri) => laplace(obs, { iterate: false, rootIndex: ri }), truthRow, TOL_CLASSICAL, tag + ' laplace-classical', b.name, b.tag, spacing, 'laplace-classical');
      });
    }
  }
});

describe('hard geometry: conjunction-window fixtures (log only)', () => {
  for (const b of BODIES) {
    for (const [spacing, days] of SPACINGS) {
      const tag = `${b.name}/${b.tag}/${spacing}d`;
      it(`${tag} returns a result or a descriptive Error`, () => {
        const fx = load<Fixture>(`${b.name}-${b.tag}.json`);
        const obs = buildObs(fx, days.map((d) => d + 10)); // days 10.. within the +-20 d window
        for (const [method, run] of [
          ['gauss', () => gauss(obs)],
          ['laplace-refined', () => laplace(obs, { iterate: true })],
        ] as const) {
          let r: IODResult | null = null;
          try {
            r = run();
          } catch (err) {
            console.log(`conjunction ${tag} ${method}: threw ${(err as Error).message}`);
            expect(err).toBeInstanceOf(Error);
            expect((err as Error).message.length).toBeGreaterThan(5);
          }
          if (r) {
            console.log(`conjunction ${tag} ${method}: a=${r.elements.a.toFixed(3)} e=${r.elements.e.toFixed(3)} converged=${r.converged} warnings=${r.warnings.length}`);
            expect(Number.isFinite(r.elements.a)).toBe(true);
          }
        }
      });
    }
  }
});

describe('solver self-consistency diagnostic', () => {
  it('ceres 10d: Gauss recovers Horizons elements from synthetic observations made with our predict()', () => {
    const fx = load<Fixture>('ceres-opposition-geocentric.json');
    const row = load<{ rows: ElRow[] }>('ceres-opposition-elements.json').rows.find((r) => r.spacingDays === 10)!;
    const el: OrbitalElements = {
      a: row.a, e: row.e, i: row.iDeg * DEG2RAD, Omega: row.OmegaDeg * DEG2RAD,
      omega: row.omegaDeg * DEG2RAD, M0: row.MDeg * DEG2RAD, epochJd: row.jdTdb, frame: 'eclipticJ2000',
    };
    const obs = [0, 10, 20].map((d): Observation => {
      const jdUtc = fx.rows[d]!.jdUtc;
      const p = predict(el, jdUtc, null);
      return { jdUtc, raRad: p.raRad, decRad: p.decRad, site: null };
    }) as IODInput;
    const res = gauss(obs);
    const x = errs(res.elements, truthAt(row, res.jdTt2));
    console.log('diagnostic (synthetic from Horizons elements, our predict):', x);
    expect(res.converged).toBe(true);
    expect(x.aRel).toBeLessThan(1e-6);
    expect(x.e).toBeLessThan(1e-6);
    expect(x.iDeg).toBeLessThan(1e-4);
  });
});

describe('control: Horizons Earth vs Standish Earth (error-budget attribution)', () => {
  it('ceres 10d opposition gauss (refined): errors with Standish vs Horizons Earth positions', () => {
    const fx = load<Fixture>('ceres-opposition-geocentric.json');
    const earth = load<{ rows: { jdUtc: number; x: number; y: number; z: number }[] }>('earth-ceres-opposition.json');
    const row = load<{ rows: ElRow[] }>('ceres-opposition-elements.json').rows.find((r) => r.spacingDays === 10)!;
    const days = [0, 10, 20];
    const obs = buildObs(fx, days);
    // Horizons rows are Earth centre, sampled at jdUtc + (TT-UTC); add the site offset if any (null for Ceres geocentric).
    const R = days.map((d, i): Vec3 => {
      const e = earth.rows[d]!;
      const o = obs[i]!;
      expect(Math.abs(e.jdUtc - o.jdUtc), `earth row ${d} jdUtc matches observation`).toBeLessThan(1e-6);
      const g: Vec3 = o.site ? observerGeocentric(o.site, o.jdUtc) : [0, 0, 0];
      return [e.x + g[0], e.y + g[1], e.z + g[2]];
    });
    const std = gauss(obs);
    const hor = gauss(obs, { observerPositions: R as [Vec3, Vec3, Vec3] });
    const xs = errs(std.elements, truthAt(row, std.jdTt2));
    const xh = errs(hor.elements, truthAt(row, hor.jdTt2));
    console.log('CONTROL ceres 10d gauss  Standish Earth:', xs);
    console.log('CONTROL ceres 10d gauss  Horizons Earth:', xh);
    expect(std.converged).toBe(true);
    expect(hor.converged).toBe(true);
    // Measured: Horizons Earth cuts e error ~80x (0.0150 -> 0.00019) and i ~100x, so Standish Earth dominates the budget.
    expect(xh.e).toBeLessThan(xs.e);
    expect(xh.iDeg).toBeLessThan(xs.iDeg);
    expect(xh.aRel).toBeLessThan(xs.aRel);
    expect(xh.e).toBeLessThan(0.002);
  });
});
