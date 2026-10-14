import { describe, expect, it } from 'vitest';
import { solveKeplerElliptic, solveKeplerHyperbolic } from './kepler';

describe('Kepler solvers', () => {
  for (const e of [0, 0.1, 0.5, 0.9, 0.99]) {
    it(`elliptic e=${e}`, () => {
      for (let k = -40; k <= 80; k++) {
        const M = (k / 10) * 1.0;
        const E = solveKeplerElliptic(M, e);
        expect(Math.abs(E - e * Math.sin(E) - M)).toBeLessThan(1e-12);
      }
      for (const M of [1e-8, -1e-8, Math.PI, 2 * Math.PI - 1e-9]) {
        const E = solveKeplerElliptic(M, e);
        expect(Math.abs(E - e * Math.sin(E) - M)).toBeLessThan(1e-12);
      }
    });
  }
  it('hyperbolic e=1.5 and others', () => {
    for (const e of [1.0001, 1.5, 5]) {
      for (const M of [-100, -5, -0.3, 0, 1e-9, 0.3, 2, 50, 1000]) {
        const H = solveKeplerHyperbolic(M, e);
        expect(Math.abs(e * Math.sinh(H) - H - M)).toBeLessThan(1e-11 * Math.max(1, Math.abs(M)));
      }
    }
  });
  it('rejects invalid e', () => {
    expect(() => solveKeplerElliptic(1, 1)).toThrow();
    expect(() => solveKeplerHyperbolic(1, 0.5)).toThrow();
  });
});
