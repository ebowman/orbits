import { describe, expect, it } from 'vitest';
import { gaussian, mulberry32, seededGaussian } from './random';

describe('random', () => {
  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(1);
    const b = mulberry32(1);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
  it('different seeds differ', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it('gaussian has ~zero mean and unit variance', () => {
    const g = seededGaussian(42);
    const n = 20000;
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const x = g();
      s += x;
      s2 += x * x;
    }
    expect(Math.abs(s / n)).toBeLessThan(0.03);
    expect(Math.abs(s2 / n - 1)).toBeLessThan(0.05);
  });
  it('gaussian is finite even for rng returning 0', () => {
    expect(Number.isFinite(gaussian(() => 0))).toBe(true);
  });
});
