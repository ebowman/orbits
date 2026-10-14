const TWO_PI = 2 * Math.PI;
const TOL = 1e-14;
const MAX_ITER = 50;

/**
 * Solve Kepler's equation M = E - e sin E for 0 <= e < 1.
 * Newton iteration with a Danby starter. The returned E is on the same
 * revolution branch as M (E - M stays within [-e, e]).
 */
export function solveKeplerElliptic(M: number, e: number): number {
  if (!(e >= 0 && e < 1)) throw new Error(`solveKeplerElliptic: e must be in [0,1), got ${e}`);
  if (!Number.isFinite(M)) throw new Error('solveKeplerElliptic: M not finite');
  const k = Math.round(M / TWO_PI);
  const m = M - k * TWO_PI; // in [-pi, pi]
  let E = m + 0.85 * e * (Math.sin(m) >= 0 ? 1 : -1);
  for (let n = 0; n < MAX_ITER; n++) {
    const dE = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < TOL) return E + k * TWO_PI;
  }
  throw new Error(`solveKeplerElliptic: no convergence (M=${M}, e=${e})`);
}

/** Solve the hyperbolic Kepler equation M = e sinh H - H for e > 1. Newton iteration. */
export function solveKeplerHyperbolic(M: number, e: number): number {
  if (!(e > 1) || !Number.isFinite(e)) throw new Error(`solveKeplerHyperbolic: e must be > 1, got ${e}`);
  if (!Number.isFinite(M)) throw new Error('solveKeplerHyperbolic: M not finite');
  if (M === 0) return 0;
  const s = M < 0 ? -1 : 1;
  const am = Math.abs(M);
  // Starter: asinh(M/e) for small |M|, logarithmic for large |M|.
  let H = am < 6 * e ? Math.asinh(am / e) : Math.log((2 * am) / e + 1.8);
  for (let n = 0; n < MAX_ITER; n++) {
    const dH = (e * Math.sinh(H) - H - am) / (e * Math.cosh(H) - 1);
    H -= dH;
    if (Math.abs(dH) < TOL * Math.max(1, Math.abs(H))) return s * H;
  }
  throw new Error(`solveKeplerHyperbolic: no convergence (M=${M}, e=${e})`);
}
