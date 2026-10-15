/**
 * Positive real roots of the Gauss/Laplace distance polynomial
 *   f(r) = r^8 + a r^6 + b r^3 + c.
 *
 * Method: sample f on a log-spaced grid over [1e-3, 1e3] AU (4001 points).
 * - Sign change (or exact zero) between neighbours: refine with bisection-
 *   safeguarded Newton.
 * - Interval where f' changes sign (a local extremum of f): locate the extremum
 *   by bisection on f'. If f there has the opposite sign to the interval's end
 *   values, two close roots are bracketed separately; if |f| is negligible
 *   (<= 1e-12 * term scale) it is reported as a double (tangent) root.
 * Roots closer than 1e-10 relative are merged. r = 0 is never reported.
 * Roots outside [1e-3, 1e3] are not found. A double root only slightly
 * off-tangent (|f_min| above the tolerance, same sign) is treated as no root.
 */
export type DistancePolynomialRoots = { roots: number[]; descartesCount: number };

const R_MIN = 1e-3;
const R_MAX = 1e3;
const N_SAMPLES = 4001;

export function solveDistancePolynomial(a: number, b: number, c: number): DistancePolynomialRoots {
  const f = (r: number) => {
    const r3 = r * r * r;
    return r3 * r3 * r * r + a * r3 * r3 + b * r3 + c;
  };
  const df = (r: number) => {
    const r2 = r * r;
    return 8 * r2 * r2 * r2 * r + 6 * a * r2 * r2 * r + 3 * b * r2;
  };
  const scaleAt = (r: number) => {
    const r3 = r * r * r;
    return Math.abs(r3 * r3 * r * r) + Math.abs(a * r3 * r3) + Math.abs(b * r3) + Math.abs(c);
  };

  const refine = (lo: number, hi: number): number => {
    let flo = f(lo);
    let x = 0.5 * (lo + hi);
    for (let it = 0; it < 200; it++) {
      const fx = f(x);
      if (fx === 0) return x;
      if ((fx < 0) === (flo < 0)) {
        lo = x;
        flo = fx;
      } else hi = x;
      const d = df(x);
      let xn = d !== 0 ? x - fx / d : NaN;
      if (!(xn > lo && xn < hi)) xn = 0.5 * (lo + hi);
      if (Math.abs(xn - x) <= 1e-15 * Math.abs(x)) return xn;
      x = xn;
    }
    return x;
  };

  const xs: number[] = [];
  const logMin = Math.log(R_MIN);
  const step = (Math.log(R_MAX) - logMin) / (N_SAMPLES - 1);
  for (let i = 0; i < N_SAMPLES; i++) xs.push(Math.exp(logMin + i * step));
  const fs = xs.map(f);
  const ds = xs.map(df);

  const found: number[] = [];
  for (let i = 0; i < N_SAMPLES - 1; i++) {
    const lo = xs[i] as number;
    const hi = xs[i + 1] as number;
    const f0 = fs[i] as number;
    const f1 = fs[i + 1] as number;
    const d0 = ds[i] as number;
    const d1 = ds[i + 1] as number;
    if (f0 === 0) {
      found.push(lo);
      continue;
    }
    if (f0 < 0 !== f1 < 0 && f1 !== 0) {
      found.push(refine(lo, hi));
      continue;
    }
    if (d0 < 0 !== d1 < 0 && d0 !== 0) {
      // Local extremum inside (lo, hi): bisect on f'.
      let l = lo;
      let h = hi;
      const dl = d0;
      for (let k = 0; k < 200; k++) {
        const m = 0.5 * (l + h);
        if (df(m) < 0 === dl < 0) l = m;
        else h = m;
        if (h - l <= 1e-16 * h) break;
      }
      const xm = 0.5 * (l + h);
      const fm = f(xm);
      if (fm !== 0 && fm < 0 !== f0 < 0) {
        found.push(refine(lo, xm), refine(xm, hi));
      } else if (Math.abs(fm) <= 1e-12 * scaleAt(xm)) {
        found.push(xm);
      }
    }
  }
  // Last grid point exactly zero.
  if (fs[N_SAMPLES - 1] === 0) found.push(xs[N_SAMPLES - 1] as number);

  found.sort((p, q) => p - q);
  const roots: number[] = [];
  for (const r of found) {
    if (roots.length === 0 || Math.abs(r - (roots[roots.length - 1] as number)) > 1e-10 * r) roots.push(r);
  }
  return { roots, descartesCount: descartes(a, b, c) };
}

/** Descartes' rule of signs: sign changes in the coefficients [1, a, b, c] (zeros skipped). */
function descartes(a: number, b: number, c: number): number {
  let count = 0;
  let prev = 1;
  for (const k of [a, b, c]) {
    if (k === 0) continue;
    const s = Math.sign(k);
    if (s !== prev) count++;
    prev = s;
  }
  return count;
}
