import { describe, expect, it } from 'vitest';
import { validateObservations } from './validate';
import type { Observation } from './types';

const o = (jd: number, ra: number, dec: number): Observation => ({ jdUtc: jd, raRad: ra, decRad: dec, site: null });
const good = (): [Observation, Observation, Observation] => [o(2460000, 1, 0.1), o(2460010, 1.01, 0.11), o(2460020, 1.02, 0.12)];

describe('validateObservations', () => {
  it('accepts good input with no warnings', () => {
    expect(validateObservations(good())).toEqual({ warnings: [] });
  });
  it('rejects wrong count', () => {
    expect(() => validateObservations(good().slice(0, 2))).toThrow(/Exactly 3/);
  });
  it('rejects non-increasing times', () => {
    const g = good();
    g[1].jdUtc = g[0].jdUtc;
    expect(() => validateObservations(g)).toThrow(/strictly increasing/);
  });
  it('rejects identical directions', () => {
    const g = good();
    g[2].raRad = g[0].raRad;
    g[2].decRad = g[0].decRad;
    expect(() => validateObservations(g)).toThrow(/same direction/);
  });
  it('rejects non-finite values and bad declination', () => {
    const g = good();
    g[0].raRad = NaN;
    expect(() => validateObservations(g)).toThrow(/right ascension/);
    const h = good();
    h[1].decRad = 2;
    expect(() => validateObservations(h)).toThrow(/declination/);
    const k = good();
    k[2].jdUtc = Infinity;
    expect(() => validateObservations(k)).toThrow(/date/);
  });
  it('warns on close spacing and long arc', () => {
    const g = good();
    g[1].jdUtc = g[0].jdUtc + 0.2;
    expect(validateObservations(g).warnings).toHaveLength(1);
    const h = good();
    h[2].jdUtc = h[0].jdUtc + 200;
    expect(validateObservations(h).warnings).toHaveLength(1);
  });
});
