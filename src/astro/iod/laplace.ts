/**
 * Laplace method of initial orbit determination (heliocentric), after Danby, "Fundamentals of
 * Celestial Mechanics" ch. 7 / Escobal, "Methods of Orbit Determination" ch. 7.
 *
 * Units: AU, days, mu = GM_SUN. All vectors are J2000 equatorial.
 *
 * Classical part: the line-of-sight unit vector L(t) is fitted through the three observations by
 * a quadratic Lagrange polynomial (unequal spacing allowed), giving L = L2, L' and L'' at t2.
 * Observer state at t2: R is observerHeliocentric at t2, and R', R'' come from the SAME quadratic
 * Lagrange fit through the three observer heliocentric positions (Earth + site offset) that is used
 * for L. Nightly samples cannot resolve the diurnal site rotation (centripetal acceleration
 * ~1.7e-3 AU/day^2, larger than the solar term), so using the analytic Earth velocity plus
 * rotation for a topocentric R' would be inconsistent with L', L''; fitting both identically
 * keeps the classical error quadratic in the time spread for geocentric and topocentric data.
 * Differentiating r = R + rho L twice and using
 * r'' = -mu r / r^3, then projecting on L x L' and L x L'', gives
 *     rho  = A + mu B / r^3   (A = -R''.n/(L''.n), B = -R.n/(L''.n), n = L x L'),
 *     rho' = -(R'' + mu R / r^3) . m / (2 L'.m)   (m = L x L'')
 * which is the same eighth-degree polynomial in r as Gauss's, solved with solveDistancePolynomial.
 * The classical result ignores light-time (apart from labelling the state at t2 - rho2/c) and is
 * only second-order accurate in the time spread.
 *
 * Refinement variant (iterate = true): "Laplace with Gauss-style f/g refinement". Starting from
 * the classical (r2, v2), the exact universal-variable Lagrange coefficients f_i, g_i to the
 * light-time corrected body times t_i - rho_i/c are computed, the Gauss linear system is solved
 * for rho_1..3, and the state is updated; this repeats (with Anderson(1) mixing, which damps the
 * light-time 2-cycle) until the slant ranges converge. The unrefined result is kept in the
 * 'classical-result' trace step.
 */
import { C_AU_PER_DAY, GM_SUN } from '../constants';
import { radecToUnit } from '../frames';
import { observerHeliocentric } from '../observer';
import { earthHeliocentric } from '../planets';
import { lagrangeFG } from '../propagate';
import { stateToElements } from '../state';
import { jdUtcToTt } from '../time';
import { add, cross, dot, norm, scale, sub, type Vec3 } from '../vec';
import { solveDistancePolynomial } from './polynomial';
import type { IODInput, IODResult, TraceStep } from './types';
import { validateObservations } from './validate';

export type LaplaceOptions = {
  iterate?: boolean;
  maxIter?: number;
  tol?: number;
  lightTime?: boolean;
  rootIndex?: number;
};

const MAX_TRACE_ITERATIONS = 20;
const D0_MIN = 1e-8;
const D0_WEAK = 1e-6;
const DET_MIN = 1e-14;
const RHO2_MIN = 1e-4;
// Earth-coincident rejection. The spurious root is the Earth's own heliocentric orbit co-moving with the observer
// (degenerate r2 ~ |R2| root): Eros +200 d converged to rho2 = 0.0155 AU with |v2 - V_earth| = 2.2e-4 AU/day
// (0.38 km/s), a = 0.998 AU, e = 0.016, i = 0.235 deg. Real close approaches also have small rho2 but km/s relative
// speeds, so a candidate is rejected only if BOTH rho2 < RHO2_EARTH AND |v2 - V_earth(t2)| < V_EARTH_REL.
const RHO2_EARTH = 0.05;
const V_EARTH_REL = 5e-4; // AU/day (~0.87 km/s)
const ABS_FLOOR = 1e-15;
const NOISE_FLOOR_REL = 1e-6;

type Triple = [number, number, number];
type Val = number | number[] | Vec3 | string;

export function laplace(obs: IODInput, opts: LaplaceOptions = {}): IODResult {
  const iterate = opts.iterate ?? true;
  const maxIter = opts.maxIter ?? 50;
  const tol = opts.tol ?? 1e-12;
  const lightTime = opts.lightTime ?? true;
  const mu = GM_SUN;
  const warnings: string[] = [...validateObservations(obs).warnings];
  const trace: TraceStep[] = [];

  // Step 1: line-of-sight unit vectors.
  const L = obs.map((o) => radecToUnit(o.raRad, o.decRad)) as [Vec3, Vec3, Vec3];
  trace.push({
    id: 'los-vectors',
    title: 'Line-of-sight unit vectors',
    explanation:
      'Each right ascension and declination pair is turned into a unit vector $\\hat\\rho_i$ pointing from the observer to the object. These give directions only; distances are still unknown.',
    values: { L1: L[0], L2: L[1], L3: L[2] },
  });

  // Step 2: Lagrange interpolation weights at t2.
  const jdTt = obs.map((o) => jdUtcToTt(o.jdUtc)) as Triple;
  const tau1 = jdTt[0] - jdTt[1];
  const tau3 = jdTt[2] - jdTt[1];
  const w1 = -tau3 / (tau1 * (tau1 - tau3));
  const w3 = -tau1 / ((tau3 - tau1) * tau3);
  const w2 = (-tau1 - tau3) / (tau1 * tau3);
  const q1 = 2 / (tau1 * (tau1 - tau3));
  const q3 = 2 / ((tau3 - tau1) * tau3);
  const q2 = 2 / (tau1 * tau3);
  trace.push({
    id: 'interpolation',
    title: 'Interpolating the line of sight',
    explanation:
      'A quadratic Lagrange polynomial through the three unit vectors, valid for unequal spacing, represents $\\hat\\rho(t)$ near the middle time. The weights below give its first and second time derivatives at $t_2$.',
    values: { tau1, tau3, firstDerivativeWeights: [w1, w2, w3], secondDerivativeWeights: [q1, q2, q3] },
  });

  const comb = (a: number, b: number, c: number): Vec3 =>
    add(add(scale(L[0], a), scale(L[1], b)), scale(L[2], c));
  const L0 = L[1];
  const Lp = comb(w1, w2, w3);
  const Lpp = comb(q1, q2, q3);
  const n = cross(L0, Lp);
  const m = cross(L0, Lpp);
  const detL = dot(Lpp, n);
  trace.push({
    id: 'derivatives',
    title: 'Line-of-sight derivatives',
    explanation:
      'The derivatives $\\hat\\rho\'$ and $\\hat\\rho\'\'$ at $t_2$ (per day and per day squared) carry the information about the apparent motion and its curvature. The triple product $\\hat\\rho\'\'\\cdot(\\hat\\rho\\times\\hat\\rho\')$ measures how well the arc is curved, and must not be near zero.',
    values: { L: L0, Lp, Lpp, n, m, det: detL },
  });
  if (!(Math.abs(detL) > DET_MIN)) {
    throw new Error('Line-of-sight curvature is too small for the Laplace method (observations nearly collinear on the sky); choose a longer arc');
  }

  // Step 3: observer state at t2, from the same Lagrange fit used for L.
  const Robs = obs.map((o, i) => observerHeliocentric(o.site, jdTt[i] as number, o.jdUtc)) as [Vec3, Vec3, Vec3];
  const combR = (a: number, b: number, c: number): Vec3 =>
    add(add(scale(Robs[0], a), scale(Robs[1], b)), scale(Robs[2], c));
  const R2 = Robs[1];
  const Rp = combR(w1, w2, w3);
  const Rpp = combR(q1, q2, q3);
  trace.push({
    id: 'observer-state',
    title: 'Observer position, velocity and acceleration',
    explanation:
      'The observer position $\\mathbf R$ at $t_2$ and its derivatives $\\mathbf R\'$, $\\mathbf R\'\'$ come from the same quadratic Lagrange fit through the three observer positions as the line of sight, so observer and sight line are treated consistently.',
    values: { R: R2, Rp, Rpp, approach: 'lagrange-interpolation of observer heliocentric positions' },
  });

  // Step 4: determinants and rho = A + mu B / r^3.
  const A = -dot(Rpp, n) / detL;
  const B = -dot(R2, n) / detL;
  const E = dot(R2, L0);
  const R2sq = dot(R2, R2);
  trace.push({
    id: 'determinants',
    title: 'Triple-product scalars',
    explanation:
      'Projecting $\\mathbf r=\\mathbf R+\\rho\\hat\\rho$ and its equation of motion onto $\\hat\\rho\\times\\hat\\rho\'$ eliminates $\\rho\'$ and $\\rho\'\'$, giving $\\rho = A + \\mu B/r^3$ with $A=-\\mathbf R\'\'\\cdot\\mathbf n/D$, $B=-\\mathbf R\\cdot\\mathbf n/D$.',
    values: { D: detL, D1: dot(Rpp, n), D2: dot(R2, n), A, B, E, R2sq },
  });

  const pa = -(A * A + 2 * A * E + R2sq);
  const pb = -2 * mu * B * (A + E);
  const pc = -mu * mu * B * B;
  const { roots, descartesCount } = solveDistancePolynomial(pa, pb, pc);
  trace.push({
    id: 'polynomial',
    title: 'Distance polynomial',
    explanation:
      'Combining $\\rho = A + \\mu B/r^3$ with $r^2 = R^2 + 2\\rho E + \\rho^2$ gives $x^8 + a x^6 + b x^3 + c = 0$ in $x = r_2$. Its positive real roots are the candidate heliocentric distances.',
    values: { a: pa, b: pb, c: pc, descartesCount },
  });
  if (roots.length === 0) {
    throw new Error('Laplace method found no positive root for the heliocentric distance; the observations are not consistent with a bound solution');
  }

  // Gauss-style linear system pieces for the refinement.
  const p1 = cross(L[1], L[2]);
  const p2 = cross(L[0], L[2]);
  const p3 = cross(L[0], L[1]);
  const D0 = dot(L[0], p1);
  const Dm = Robs.map((Ri) => [p1, p2, p3].map((p) => dot(Ri, p)));
  if (iterate) {
    if (!(Math.abs(D0) > D0_MIN)) {
      throw new Error('Observations are nearly coplanar with the Sun-observer geometry; choose different times');
    }
    if (Math.abs(D0) < D0_WEAK) warnings.push(`weak geometry: D0=${D0.toExponential(3)}`);
  }
  const solveFromFG = (f1: number, g1: number, f3: number, g3: number) => {
    const den = f1 * g3 - f3 * g1;
    const c1 = g3 / den;
    const c3 = -g1 / den;
    const d = (i: number, j: number) => (Dm[i] as number[])[j] as number;
    const rho1 = (d(1, 0) - c1 * d(0, 0) - c3 * d(2, 0)) / (c1 * D0);
    const rho2 = (d(1, 1) - c1 * d(0, 1) - c3 * d(2, 1)) / D0;
    const rho3 = (d(1, 2) - c1 * d(0, 2) - c3 * d(2, 2)) / (c3 * D0);
    return { c1, c3, den, rho: [rho1, rho2, rho3] as Triple };
  };

  // Classical Laplace state for a trial root.
  const classicalFor = (r: number) => {
    const r3 = r ** 3;
    const rho = A + (mu * B) / r3;
    const acc = add(Rpp, scale(R2, mu / r3));
    const rhoDot = -dot(acc, m) / (2 * dot(Lp, m));
    const rv = add(R2, scale(L0, rho));
    const v = add(add(Rp, scale(L0, rhoDot)), scale(Lp, rho));
    return { rho, rhoDot, r: rv, v };
  };

  type Run = {
    root: number;
    cl: ReturnType<typeof classicalFor>;
    rho: Triple;
    r2: Vec3;
    v2: Vec3;
    iterations: number;
    converged: boolean;
    jdTt2: number;
    iterSteps: TraceStep[];
    elements: ReturnType<typeof stateToElements> | null;
    clElements: ReturnType<typeof stateToElements> | null;
    clJdTt2: number;
    reason: string | null;
    noiseFloor: number | null;
  };

  const VS = 1 / Math.sqrt(mu);
  const pack = (rho: Triple, r: Vec3, v: Vec3): number[] => [...rho, ...r, v[0] * VS, v[1] * VS, v[2] * VS];

  const runRoot = (root: number): Run => {
    const cl = classicalFor(root);
    const clJd = jdTt[1] - (lightTime ? cl.rho / C_AU_PER_DAY : 0);
    const run: Run = {
      root,
      cl,
      rho: [cl.rho, cl.rho, cl.rho],
      r2: cl.r,
      v2: cl.v,
      iterations: 0,
      converged: !iterate,
      jdTt2: clJd,
      iterSteps: [],
      elements: null,
      clElements: null,
      clJdTt2: clJd,
      reason: null,
      noiseFloor: null,
    };
    if (!Number.isFinite(cl.rho) || !Number.isFinite(cl.rhoDot) || !cl.v.every(Number.isFinite)) {
      run.reason = 'classical slant range or rate is not finite';
      return run;
    }
    if (!(cl.rho >= RHO2_MIN)) {
      run.reason = `rho2 = ${cl.rho.toExponential(2)} AU is below ${RHO2_MIN} AU (Earth-coincident or behind the observer)`;
      return run;
    }
    try {
      run.clElements = stateToElements(cl.r, cl.v, clJd, mu);
    } catch (err) {
      run.reason = `state-to-elements failed: ${err instanceof Error ? err.message : String(err)}`;
      return run;
    }
    if (!iterate) return run;

    let r2v = cl.r;
    let v2v = cl.v;
    let rho: Triple = [cl.rho, cl.rho, cl.rho];
    let prev: { f: number[]; y: number[] } | null = null;
    const history: number[] = [];
    try {
      for (let k = 1; k <= maxIter; k++) {
        run.iterations = k;
        const lt = lightTime ? rho.map((x) => x / C_AU_PER_DAY) : [0, 0, 0];
        const tb = jdTt.map((t, i) => t - (lt[i] as number)) as Triple;
        const dt1 = tb[0] - tb[1];
        const dt3 = tb[2] - tb[1];
        const fg1 = lagrangeFG(r2v, v2v, dt1, mu);
        const fg3 = lagrangeFG(r2v, v2v, dt3, mu);
        const s = solveFromFG(fg1.f, fg1.g, fg3.f, fg3.g);
        if (!s.rho.every(Number.isFinite)) {
          run.reason = 'iteration diverged (non-finite slant range)';
          return run;
        }
        const newR = s.rho.map((x, i) => add(Robs[i] as Vec3, scale(L[i] as Vec3, x))) as [Vec3, Vec3, Vec3];
        const newV2 = scale(add(scale(newR[0], -fg3.f), scale(newR[2], fg1.f)), 1 / s.den);
        const dRho = Math.max(...s.rho.map((x, i) => Math.abs(x - (rho[i] as number))));
        const rhoMax = Math.max(...s.rho.map(Math.abs));
        if (k <= MAX_TRACE_ITERATIONS) {
          run.iterSteps.push({
            id: `iteration-${k}`,
            title: `Refinement iteration ${k}`,
            explanation:
              'The exact universal-variable $f$ and $g$ (with body time corrected for light travel, $t_i - \\rho_i/c$) replace the low-order Laplace estimate, and the slant ranges are recomputed. The change in $\\rho$ shows how close the iteration is to convergence.',
            values: {
              rho: s.rho,
              r1: newR[0],
              r2: newR[1],
              r3: newR[2],
              rNorms: [norm(newR[0]), norm(newR[1]), norm(newR[2])],
              v2: newV2,
              f1: fg1.f,
              g1: fg1.g,
              f3: fg3.f,
              g3: fg3.g,
              c1: s.c1,
              c3: s.c3,
              lightTimeDays: lt,
              deltaRho: dRho,
            },
          });
        }
        run.rho = s.rho;
        run.r2 = newR[1];
        run.v2 = newV2;
        run.jdTt2 = jdTt[1] - (lightTime ? s.rho[1] / C_AU_PER_DAY : 0);
        if (dRho <= tol * rhoMax + ABS_FLOOR) {
          run.converged = true;
          break;
        }
        history.push(dRho);
        if (history.length > 3 && dRho < NOISE_FLOOR_REL * rhoMax && tol >= 0) {
          const prevMin = Math.min(...history.slice(-4, -1));
          if (dRho >= 0.9 * prevMin) {
            run.converged = true;
            run.noiseFloor = dRho;
            break;
          }
        }
        // Anderson(1) mixing: handles slow monotone convergence and light-time 2-cycles.
        const x = pack(rho, r2v, v2v);
        const y = pack(s.rho, newR[1], newV2);
        const f = y.map((yy, j) => yy - (x[j] as number));
        let xn = y;
        if (prev) {
          const df = f.map((ff, j) => ff - (prev!.f[j] as number));
          const den = df.reduce((acc, v) => acc + v * v, 0);
          if (den > 0) {
            const gamma = f.reduce((acc, v, j) => acc + v * (df[j] as number), 0) / den;
            if (Math.abs(gamma) <= 10) xn = y.map((yy, j) => yy - gamma * (yy - (prev!.y[j] as number)));
          }
        }
        if (!xn.every(Number.isFinite)) xn = y;
        prev = { f, y };
        rho = [xn[0] as number, xn[1] as number, xn[2] as number];
        r2v = [xn[3] as number, xn[4] as number, xn[5] as number];
        v2v = [(xn[6] as number) / VS, (xn[7] as number) / VS, (xn[8] as number) / VS];
      }
    } catch (err) {
      run.reason = `iteration failed: ${err instanceof Error ? err.message : String(err)}`;
      return run;
    }
    return run;
  };

  const earthRelSpeed = (r: { v2: Vec3; jdTt2: number }): number => norm(sub(r.v2, earthHeliocentric(r.jdTt2).v));

  const runs = roots.map(runRoot);
  for (const run of runs) {
    if (run.reason !== null) continue;
    if (!run.converged) run.reason = `did not converge in ${maxIter} iterations`;
    else if (!(run.rho[1] >= RHO2_MIN) && iterate) run.reason = `final rho2 = ${run.rho[1].toExponential(2)} AU is below ${RHO2_MIN} AU`;
    else if (iterate && run.rho[1] < RHO2_EARTH && earthRelSpeed(run) < V_EARTH_REL) {
      run.reason = `final rho2 = ${run.rho[1].toFixed(4)} AU is below ${RHO2_EARTH} AU and |v2 - V_earth| = ${earthRelSpeed(run).toExponential(2)} AU/day is below ${V_EARTH_REL} AU/day (Earth-coincident: the solution is the Earth's own orbit)`;
    }
    else if (iterate && run.rho.some((x) => !(x >= 0))) {
      run.reason = `negative slant range (rho = ${run.rho.map((x) => x.toFixed(4)).join(', ')} AU)`;
    } else {
      try {
        run.elements = iterate ? stateToElements(run.r2, run.v2, run.jdTt2, mu) : run.clElements;
      } catch (err) {
        run.reason = `state-to-elements failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }
  const survivors = runs.map((_, k) => k).filter((k) => (runs[k] as Run).reason === null);

  let chosenIdx: number;
  if (opts.rootIndex !== undefined) {
    if (!Number.isInteger(opts.rootIndex) || opts.rootIndex < 0 || opts.rootIndex >= roots.length) {
      throw new Error(`rootIndex ${opts.rootIndex} is out of range; ${roots.length} root(s) are available`);
    }
    chosenIdx = opts.rootIndex;
    const why = (runs[chosenIdx] as Run).reason;
    if (why !== null) {
      warnings.push(`The requested root ${(roots[chosenIdx] as number).toFixed(4)} AU would normally be rejected: ${why}.`);
    }
  } else {
    if (survivors.length === 0) {
      throw new Error(
        'Laplace method found no physically valid solution. ' +
          runs.map((r) => `Root r2 = ${r.root.toFixed(4)} AU rejected: ${r.reason}.`).join(' '),
      );
    }
    const isElliptic = (k: number) => ((runs[k] as Run).elements as { elements: { e: number } }).elements.e < 1;
    const ellipticFirst = survivors.filter(isElliptic);
    const pool = ellipticFirst.length > 0 ? ellipticFirst : survivors;
    if (ellipticFirst.length === 0) warnings.push('No candidate root gives an elliptic orbit; using the largest valid root.');
    chosenIdx = Math.max(...pool);
    if (survivors.length > 1) {
      warnings.push(
        `${survivors.length} candidate roots gave valid solutions (${survivors
          .map((k) => {
            const e = ((runs[k] as Run).elements as { elements: { e: number; a: number } }).elements;
            return `r2=${(roots[k] as number).toFixed(4)} AU: a=${e.a.toFixed(4)}, e=${e.e.toFixed(4)}`;
          })
          .join('; ')}); the chosen one is r2 = ${(roots[chosenIdx] as number).toFixed(4)} AU.`,
      );
    }
  }
  if (roots.length > 1) {
    warnings.push(`The distance polynomial has ${roots.length} positive roots (${roots.map((r) => r.toFixed(4)).join(', ')} AU).`);
  }
  const chosen = runs[chosenIdx] as Run;
  const rootValues: Record<string, Val> = { roots, chosenIndex: chosenIdx, chosenRoot: chosen.root };
  runs.forEach((r, k) => {
    rootValues[`status-${k}`] = r.reason === null ? 'accepted' : `rejected: ${r.reason}`;
  });
  trace.push({
    id: 'roots',
    title: 'Root selection',
    explanation:
      'Every positive root is tried (and fully refined when iterating). Roots that give a slant range near zero (the Earth itself), a negative range, or no convergence are rejected; of the rest, bound (elliptic) orbits are preferred and then the largest distance.',
    values: rootValues,
  });
  trace.push({
    id: 'rho-rhodot',
    title: 'Slant range and range rate',
    explanation:
      'For the chosen $r_2$, $\\rho = A + \\mu B/r_2^3$ and $\\rho\'$ follows from projecting onto $\\hat\\rho\\times\\hat\\rho\'\'$. Then $\\mathbf r_2=\\mathbf R+\\rho\\hat\\rho$ and $\\mathbf v_2=\\mathbf R\'+\\rho\'\\hat\\rho+\\rho\\hat\\rho\'$.',
    values: { rho: chosen.cl.rho, rhoDot: chosen.cl.rhoDot, r2: chosen.cl.r, v2: chosen.cl.v },
  });
  const clEl = chosen.clElements?.elements;
  trace.push({
    id: 'classical-result',
    title: 'Classical Laplace result',
    explanation:
      'This is the raw Laplace solution, accurate only to second order in the time spread and ignoring light-time. It is the starting point of the refinement and is shown so the two can be compared.',
    values: {
      r2: chosen.cl.r,
      v2: chosen.cl.v,
      jdTt2: chosen.clJdTt2,
      ...(clEl
        ? { a: clEl.a, e: clEl.e, i: clEl.i, Omega: clEl.Omega, omega: clEl.omega, M0: clEl.M0, epochJd: clEl.epochJd }
        : {}),
    },
  });
  trace.push(...chosen.iterSteps);

  const { iterations, converged, rho, r2: r2v, v2: v2v, jdTt2 } = chosen;
  if (chosen.noiseFloor !== null) {
    warnings.push(
      `Iteration stopped at the numerical noise floor (change in rho ${chosen.noiseFloor.toExponential(1)} AU) rather than reaching ${tol}.`,
    );
  }
  if (!converged) warnings.push(`Laplace iteration did not converge within ${maxIter} iterations (tolerance ${tol}).`);
  if (!iterate) warnings.push('Classical Laplace result (no iterative refinement); accuracy is limited by the time spread.');
  trace.push({
    id: 'final-state',
    title: 'Final state vector',
    explanation: iterate
      ? 'After refinement, the position and velocity at the middle observation are the heliocentric state of the object, at the light-time corrected body time.'
      : 'Without refinement the classical Laplace state is final.',
    values: { r2: r2v, v2: v2v, jdTt2, rho: iterate ? rho : [chosen.cl.rho], iterations, converged: converged ? 'yes' : 'no' },
  });

  const { elements, warnings: elWarnings } = chosen.elements ?? stateToElements(r2v, v2v, jdTt2, mu);
  warnings.push(...elWarnings);
  if (elements.e >= 1) warnings.push('The solved orbit is not bound (e >= 1).');
  trace.push({
    id: 'elements',
    title: 'Orbital elements',
    explanation: 'The state vector is converted to classical elements (ecliptic J2000, osculating at the middle body time).',
    values: {
      a: elements.a,
      e: elements.e,
      i: elements.i,
      Omega: elements.Omega,
      omega: elements.omega,
      M0: elements.M0,
      epochJd: elements.epochJd,
    },
  });

  return {
    method: 'laplace',
    elements,
    r2: r2v,
    v2: v2v,
    jdTt2,
    rootsConsidered: roots,
    chosenRoot: chosen.root,
    iterations,
    converged,
    warnings,
    trace,
  };
}
