import { describe, expect, it } from 'vitest';
import { solveDistancePolynomial } from './polynomial';

type V3 = [number, number, number];
type M3 = [V3, V3, V3];

// Solve 3x3 linear system by Cramer's rule.
function solve3(m: M3, y: V3): V3 {
  const det = (q: M3) =>
    q[0][0] * (q[1][1] * q[2][2] - q[1][2] * q[2][1]) -
    q[0][1] * (q[1][0] * q[2][2] - q[1][2] * q[2][0]) +
    q[0][2] * (q[1][0] * q[2][1] - q[1][1] * q[2][0]);
  const d = det(m);
  const col = (j: number): number => {
    const q = m.map((r, i) => r.map((v, k) => (k === j ? y[i] : v))) as M3;
    return det(q) / d;
  };
  return [col(0), col(1), col(2)];
}
const row = (r: number): V3 => [r ** 6, r ** 3, 1];

function fromRoots(want: V3) {
  const [a, b, c] = solve3(
    [row(want[0]), row(want[1]), row(want[2])],
    [-(want[0] ** 8), -(want[1] ** 8), -(want[2] ** 8)],
  );
  return { a, b, c };
}
const nth = (arr: number[], i: number): number => arr[i] as number;

describe('solveDistancePolynomial', () => {
  it('finds a single root', () => {
    const { roots, descartesCount } = solveDistancePolynomial(0, 0, -(2.5 ** 8));
    expect(roots).toHaveLength(1);
    expect(Math.abs(nth(roots, 0) - 2.5) / 2.5).toBeLessThan(1e-12);
    expect(descartesCount).toBe(1);
  });

  it('finds three roots', () => {
    const want: V3 = [0.8, 1.5, 2.7];
    const { a, b, c } = fromRoots(want);
    const { roots, descartesCount } = solveDistancePolynomial(a, b, c);
    expect(descartesCount).toBe(3);
    expect(roots).toHaveLength(3);
    want.forEach((w, i) => expect(Math.abs(nth(roots, i) - w) / w).toBeLessThan(1e-12));
  });

  it('finds a near-double root pair', () => {
    const want: V3 = [1.5, 1.5 + 1e-4, 3];
    const { a, b, c } = fromRoots(want);
    const { roots } = solveDistancePolynomial(a, b, c);
    expect(roots).toHaveLength(3);
    want.forEach((w, i) => expect(Math.abs(nth(roots, i) - w) / w).toBeLessThan(1e-6));
  });

  it('finds an exact double (tangent) root', () => {
    const r0 = 1.5;
    const r3 = 3;
    const m: M3 = [row(r0), [6 * r0 ** 5, 3 * r0 ** 2, 0], row(r3)];
    const [a, b, c] = solve3(m, [-(r0 ** 8), -8 * r0 ** 7, -(r3 ** 8)]);
    const { roots } = solveDistancePolynomial(a, b, c);
    expect(roots.length).toBeGreaterThanOrEqual(2);
    expect(roots.some((r) => Math.abs(r - r0) / r0 < 1e-5)).toBe(true);
    expect(roots.some((r) => Math.abs(r - r3) / r3 < 1e-10)).toBe(true);
  });

  it('returns no roots when c > 0 and a, b >= 0', () => {
    const { roots, descartesCount } = solveDistancePolynomial(0, 0, 1);
    expect(roots).toEqual([]);
    expect(descartesCount).toBe(0);
  });

  it('reports no spurious roots: every root is a zero of f', () => {
    const { a, b, c } = fromRoots([0.9, 1.2, 4.1]);
    const { roots } = solveDistancePolynomial(a, b, c);
    for (const r of roots) {
      const f = r ** 8 + a * r ** 6 + b * r ** 3 + c;
      expect(Math.abs(f)).toBeLessThan(1e-9 * (r ** 8 + Math.abs(a * r ** 6) + Math.abs(b * r ** 3) + Math.abs(c)));
    }
    expect(roots).toHaveLength(3);
  });
});
