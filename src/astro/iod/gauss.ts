/**
 * Gauss method of initial orbit determination (heliocentric), following
 * Curtis, "Orbital Mechanics for Engineering Students", Algorithms 5.5 and 5.6.
 *
 * Units: AU, days, mu = GM_SUN (AU^3/day^2). Time intervals are kept in days and mu
 * is the Gaussian k^2, which is equivalent to Curtis's scaled time tau = k * dt.
 * All vectors are J2000 equatorial.
 */
import { C_AU_PER_DAY, GM_SUN } from '../constants';
import { radecToUnit } from '../frames';
import { observerHeliocentric } from '../observer';
import { lagrangeFG } from '../propagate';
import { stateToElements } from '../state';
import { jdUtcToTt } from '../time';
import { add, cross, dot, norm, scale, type Vec3 } from '../vec';
import { solveDistancePolynomial } from './polynomial';
import type { IODInput, IODResult, TraceStep } from './types';
import { validateObservations } from './validate';

export type GaussOptions = {
  maxIter?: number;
  tol?: number;
  lightTime?: boolean;
  rootIndex?: number;
};

const MAX_TRACE_ITERATIONS = 20;
const D0_MIN = 1e-8;
const D0_WEAK = 1e-6;
const RHO2_MIN = 1e-4;
const ABS_FLOOR = 1e-15;
const NOISE_FLOOR_REL = 1e-6;

type Triple = [number, number, number];

/** Slant ranges, heliocentric positions and middle velocity from f, g coefficients. */
function solveFromFG(
  f1: number,
  g1: number,
  f3: number,
  g3: number,
  d: { D0: number; D: number[][] },
  R: [Vec3, Vec3, Vec3],
) {
  const den = f1 * g3 - f3 * g1;
  const c1 = g3 / den;
  const c3 = -g1 / den;
  const { D0, D } = d;
  // Dij = Ri . pj, stored D[i][j] with zero-based indices.
  const rho1 = ((D[1]![0] as number) - c1 * (D[0]![0] as number) - c3 * (D[2]![0] as number)) / (c1 * D0);
  const rho2 = ((D[1]![1] as number) - c1 * (D[0]![1] as number) - c3 * (D[2]![1] as number)) / D0;
  const rho3 = ((D[1]![2] as number) - c1 * (D[0]![2] as number) - c3 * (D[2]![2] as number)) / (c3 * D0);
  return { c1, c3, rho: [rho1, rho2, rho3] as Triple, den, R };
}

export function gauss(obs: IODInput, opts: GaussOptions = {}): IODResult {
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
      'Each right ascension and declination pair is turned into a unit vector $\\hat\\rho_i$ pointing from the observer to the object. These give the directions only; the distances are still unknown.',
    values: { L1: L[0], L2: L[1], L3: L[2] },
  });

  // Step 2: observer positions.
  const jdTt = obs.map((o) => jdUtcToTt(o.jdUtc)) as Triple;
  const R = obs.map((o, i) => observerHeliocentric(o.site, jdTt[i] as number, o.jdUtc)) as [Vec3, Vec3, Vec3];
  trace.push({
    id: 'observer-positions',
    title: 'Observer positions',
    explanation:
      'The Sun-to-observer position vectors $\\mathbf R_i$ at the three observation times come from the Earth ephemeris plus the site offset. These are known exactly, so all the uncertainty is in the object.',
    values: { R1: R[0], R2: R[1], R3: R[2], jdTt1: jdTt[0], jdTt2: jdTt[1], jdTt3: jdTt[2] },
  });

  // Step 3: time intervals.
  const tau1 = jdTt[0] - jdTt[1];
  const tau3 = jdTt[2] - jdTt[1];
  const tau = tau3 - tau1;
  trace.push({
    id: 'time-intervals',
    title: 'Time intervals',
    explanation:
      'The intervals $\\tau_1 = t_1 - t_2$ and $\\tau_3 = t_3 - t_2$ are measured from the middle observation, and $\\tau = \\tau_3 - \\tau_1$. They are in days and do not yet include light-time.',
    values: { tau1, tau3, tau },
  });

  // Step 4: determinants.
  const p1 = cross(L[1], L[2]);
  const p2 = cross(L[0], L[2]);
  const p3 = cross(L[0], L[1]);
  const D0 = dot(L[0], p1);
  if (!(Math.abs(D0) > D0_MIN)) {
    throw new Error('Observations are nearly coplanar with the Sun-observer geometry; choose different times');
  }
  if (Math.abs(D0) < D0_WEAK) warnings.push(`weak geometry: D0=${D0.toExponential(3)}`);
  const ps = [p1, p2, p3];
  const D = R.map((Ri) => ps.map((p) => dot(Ri, p)));
  const d = { D0, D };
  const D12 = D[0]![1] as number;
  const D22 = D[1]![1] as number;
  const D32 = D[2]![1] as number;
  const A = (1 / D0) * ((-D12 * tau3) / tau + D22 + (D32 * tau1) / tau);
  const B =
    (1 / (6 * D0)) *
    ((D12 * (tau3 * tau3 - tau * tau) * tau3) / tau + (D32 * (tau * tau - tau1 * tau1) * tau1) / tau);
  const E = dot(R[1], L[1]);
  const R2sq = dot(R[1], R[1]);
  trace.push({
    id: 'd-scalars',
    title: 'Triple-product scalars',
    explanation:
      'The scalar $D_0 = \\hat\\rho_1\\cdot(\\hat\\rho_2\\times\\hat\\rho_3)$ and the nine $D_{ij} = \\mathbf R_i\\cdot\\mathbf p_j$ reduce the vector equations to scalar ones. From them come $A$ and $B$, which give the middle slant range as $\\rho_2 = A + \\mu B / r_2^3$.',
    values: { D0, D: D.flat(), A, B, E, R2sq },
  });

  // Step 5: polynomial.
  const pa = -(A * A + 2 * A * E + R2sq);
  const pb = -2 * mu * B * (A + E);
  const pc = -mu * mu * B * B;
  const { roots, descartesCount } = solveDistancePolynomial(pa, pb, pc);
  trace.push({
    id: 'polynomial',
    title: 'Distance polynomial',
    explanation:
      'Combining $\\rho_2 = A + \\mu B/r_2^3$ with $r_2^2 = R_2^2 + 2\\rho_2 E + \\rho_2^2$ gives an eighth-degree polynomial $x^8 + a x^6 + b x^3 + c = 0$ in $x = r_2$. Its positive real roots are the candidate heliocentric distances.',
    values: { a: pa, b: pb, c: pc, descartesCount },
  });

  if (roots.length === 0) {
    throw new Error('Gauss method found no positive root for the heliocentric distance; the observations are not consistent with a bound solution');
  }

  // Series-based initial orbit for a trial r2.
  const initialFor = (r2m: number) => {
    const r2c = r2m ** 3;
    const f1 = 1 - (mu * tau1 * tau1) / (2 * r2c);
    const f3 = 1 - (mu * tau3 * tau3) / (2 * r2c);
    const g1 = tau1 - (mu * tau1 ** 3) / (6 * r2c);
    const g3 = tau3 - (mu * tau3 ** 3) / (6 * r2c);
    const s = solveFromFG(f1, g1, f3, g3, d, R);
    const rv = s.rho.map((rho, i) => add(R[i] as Vec3, scale(L[i] as Vec3, rho))) as [Vec3, Vec3, Vec3];
    const v2 = scale(add(scale(rv[0], -f3), scale(rv[2], f1)), 1 / s.den);
    return { f1, g1, f3, g3, ...s, rv, v2 };
  };

  type Run = {
    root: number;
    init: ReturnType<typeof initialFor>;
    rho: Triple;
    r2: Vec3;
    v2: Vec3;
    iterations: number;
    converged: boolean;
    jdTt2: number;
    iterSteps: TraceStep[];
    elements: ReturnType<typeof stateToElements> | null;
    reason: string | null;
    noiseFloor: number | null;
  };

  const VS = 1 / Math.sqrt(mu); // scales velocity to be comparable with AU in the mixing vector
  const pack = (rho: Triple, r: Vec3, v: Vec3): number[] => [...rho, ...r, v[0] * VS, v[1] * VS, v[2] * VS];

  const runRoot = (root: number): Run => {
    const init = initialFor(root);
    const run: Run = {
      root,
      init,
      rho: init.rho,
      r2: init.rv[1],
      v2: init.v2,
      iterations: 0,
      converged: false,
      jdTt2: jdTt[1],
      iterSteps: [],
      elements: null,
      reason: null,
      noiseFloor: null,
    };
    if (!init.rho.every(Number.isFinite) || !init.v2.every(Number.isFinite)) {
      run.reason = 'initial slant ranges are not finite';
      return run;
    }
    if (!(init.rho[1] >= RHO2_MIN)) {
      run.reason = `initial rho2 = ${init.rho[1].toExponential(2)} AU is below ${RHO2_MIN} AU (Earth-coincident or behind the observer)`;
      return run;
    }
    let r2v = init.rv[1];
    let v2v = init.v2;
    let rho: Triple = init.rho;
    let prev: { f: number[]; y: number[] } | null = null;
    const history: number[] = [];
    try {
      for (let n = 1; n <= maxIter; n++) {
        run.iterations = n;
        const lt = lightTime ? rho.map((x) => x / C_AU_PER_DAY) : [0, 0, 0];
        const tb = jdTt.map((t, i) => t - (lt[i] as number)) as Triple;
        const dt1 = tb[0] - tb[1];
        const dt3 = tb[2] - tb[1];
        const fg1 = lagrangeFG(r2v, v2v, dt1, mu);
        const fg3 = lagrangeFG(r2v, v2v, dt3, mu);
        const s = solveFromFG(fg1.f, fg1.g, fg3.f, fg3.g, d, R);
        if (!s.rho.every(Number.isFinite)) {
          run.reason = 'iteration diverged (non-finite slant range)';
          return run;
        }
        const newR = s.rho.map((x, i) => add(R[i] as Vec3, scale(L[i] as Vec3, x))) as [Vec3, Vec3, Vec3];
        const newV2 = scale(add(scale(newR[0], -fg3.f), scale(newR[2], fg1.f)), 1 / s.den);
        const delta = s.rho.map((x, i) => x - (rho[i] as number));
        const dRho = Math.max(Math.abs(delta[0] as number), Math.abs(delta[1] as number), Math.abs(delta[2] as number));
        const rhoMax = Math.max(...s.rho.map(Math.abs));
        const h = norm(cross(newR[1], newV2));
        const y1 = (h * Math.abs(dt1)) / norm(cross(newR[0], newR[1]));
        const y3 = (h * Math.abs(dt3)) / norm(cross(newR[1], newR[2]));
        if (n <= MAX_TRACE_ITERATIONS) {
          run.iterSteps.push({
            id: `iteration-${n}`,
            title: `Refinement iteration ${n}`,
            explanation:
              'The exact universal-variable $f$ and $g$ (with the body time corrected for light travel, $t_i - \\rho_i/c$) replace the series, and the slant ranges are recomputed. The change in $\\rho$ shows how close the iteration is to convergence.',
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
              y1,
              y3,
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
        // Numerical noise floor: the update has stopped shrinking at a tiny level (rounding in the
        // universal-variable solver amplified by the small D0), so further iterations cannot help.
        history.push(dRho);
        if (history.length > 3 && dRho < NOISE_FLOOR_REL * rhoMax && tol >= 0) {
          const prevMin = Math.min(...history.slice(-4, -1));
          if (dRho >= 0.9 * prevMin) {
            run.converged = true;
            run.noiseFloor = dRho;
            break;
          }
        }
        // Next input: Anderson(1) mixing of the fixed-point map (handles both slow monotone
        // convergence and period-2 cycles); falls back to the plain step when degenerate.
        const x = pack(rho, r2v, v2v);
        const y = pack(s.rho, newR[1], newV2);
        const f = y.map((yy, k) => yy - (x[k] as number));
        let xn = y;
        let gamma = 0;
        if (prev) {
          const df = f.map((ff, k) => ff - (prev!.f[k] as number));
          const den = df.reduce((acc, v) => acc + v * v, 0);
          if (den > 0) {
            gamma = f.reduce((acc, v, k) => acc + v * (df[k] as number), 0) / den;
            if (Math.abs(gamma) <= 10) {
              xn = y.map((yy, k) => yy - gamma * (yy - (prev!.y[k] as number)));
            } else gamma = 0;
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

  // Fully iterate every candidate root.
  const runs = roots.map(runRoot);
  for (const run of runs) {
    if (run.reason === null) {
      if (!run.converged) run.reason = `did not converge in ${maxIter} iterations`;
      else if (!(run.rho[1] >= RHO2_MIN)) run.reason = `final rho2 = ${run.rho[1].toExponential(2)} AU is below ${RHO2_MIN} AU`;
      else if (run.rho.some((x) => !(x >= 0))) {
        run.reason = `negative slant range (rho = ${run.rho.map((x) => x.toFixed(4)).join(', ')} AU)`;
      } else {
        try {
          run.elements = stateToElements(run.r2, run.v2, run.jdTt2, mu);
        } catch (err) {
          run.reason = `state-to-elements failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
    }
  }
  const survivors = runs.map((r, k) => k).filter((k) => (runs[k] as Run).reason === null);

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
        'Gauss method found no physically valid solution. ' +
          runs.map((r) => `Root r2 = ${r.root.toFixed(4)} AU rejected: ${r.reason}.`).join(' '),
      );
    }
    const ellipticFirst = survivors.filter((k) => ((runs[k] as Run).elements as { elements: { e: number } }).elements.e < 1);
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
    warnings.push(
      `The distance polynomial has ${roots.length} positive roots (${roots.map((r) => r.toFixed(4)).join(', ')} AU).`,
    );
  }
  const chosen = runs[chosenIdx] as Run;
  const chosenRoot = chosen.root;
  const rootValues: Record<string, number | number[] | Vec3 | string> = {
    roots,
    chosenIndex: chosenIdx,
    chosenRoot,
  };
  runs.forEach((r, k) => {
    rootValues[`status-${k}`] = r.reason === null ? 'accepted' : `rejected: ${r.reason}`;
  });
  trace.push({
    id: 'roots',
    title: 'Root selection',
    explanation:
      'Every positive root is tried and fully refined. Roots that give a slant range near zero (the Earth itself), a negative range, or no convergence are rejected; of the rest, bound (elliptic) orbits are preferred and then the largest distance.',
    values: rootValues,
  });

  const init = chosen.init;
  trace.push({
    id: 'slant-ranges',
    title: 'Slant ranges',
    explanation:
      'With the chosen $r_2$, truncated series give the Lagrange coefficients $f_i$, $g_i$, and from them the Lagrange weights $c_1$, $c_3$. Solving the vector relation $c_1\\mathbf r_1 + c_3\\mathbf r_3 = \\mathbf r_2$ along the three lines of sight yields the slant ranges $\\rho_i$.',
    values: { f1: init.f1, g1: init.g1, f3: init.f3, g3: init.g3, c1: init.c1, c3: init.c3, rho: init.rho },
  });
  trace.push({
    id: 'initial-orbit',
    title: 'Initial state',
    explanation:
      'The heliocentric positions are $\\mathbf r_i = \\mathbf R_i + \\rho_i\\hat\\rho_i$, and the middle velocity follows from $\\mathbf v_2 = (-f_3\\mathbf r_1 + f_1\\mathbf r_3)/(f_1 g_3 - f_3 g_1)$. This first guess uses only low-order series, so it is refined next.',
    values: { r1: init.rv[0], r2: init.rv[1], r3: init.rv[2], v2: init.v2, rho: init.rho },
  });
  trace.push(...chosen.iterSteps);

  const { iterations, converged, rho, r2: r2v, v2: v2v, jdTt2 } = chosen;
  if (chosen.noiseFloor !== null) {
    warnings.push(
      `Iteration stopped at the numerical noise floor (change in rho ${chosen.noiseFloor.toExponential(1)} AU) rather than reaching ${tol}.`,
    );
  }
  if (!converged) {
    warnings.push(`Gauss iteration did not converge within ${maxIter} iterations (tolerance ${tol}).`);
  }
  trace.push({
    id: 'final-state',
    title: 'Final state vector',
    explanation:
      'After refinement, the position and velocity at the middle observation are the heliocentric state of the object, at the light-time corrected body time.',
    values: { r2: r2v, v2: v2v, jdTt2, rho, iterations, converged: converged ? 'yes' : 'no' },
  });

  const { elements, warnings: elWarnings } = chosen.elements ?? stateToElements(r2v, v2v, jdTt2, mu);
  warnings.push(...elWarnings);
  if (elements.e >= 1) warnings.push('The solved orbit is not bound (e >= 1).');
  trace.push({
    id: 'elements',
    title: 'Orbital elements',
    explanation:
      'The state vector is converted to classical elements (ecliptic J2000, osculating at the middle body time).',
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
    method: 'gauss',
    elements,
    r2: r2v,
    v2: v2v,
    jdTt2,
    rootsConsidered: roots,
    chosenRoot,
    iterations,
    converged,
    warnings,
    trace,
  };
}
