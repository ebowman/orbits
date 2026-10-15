import { describe, expect, it } from 'vitest';
import { cross, dot, norm, unit, OBLIQUITY_J2000_RAD, type OrbitalElements } from '@astro';
import { bodyPositionEcliptic, sampleOrbit, toDisplay } from './geometry';

const base: OrbitalElements = {
  a: 2.77, e: 0.0785, i: 0.18, Omega: 1.4, omega: 1.2, M0: 0.3, epochJd: 2460000.5, frame: 'eclipticJ2000',
};
const ecc: OrbitalElements = { ...base, a: 3.1, e: 0.6, i: 0.5, Omega: 2.2, omega: 4.0 };

describe('sampleOrbit ellipse', () => {
  for (const el of [base, ecc]) {
    const pts = sampleOrbit(el, 512);
    const q = el.a * (1 - el.e);
    const Q = el.a * (1 + el.e);
    it(`e=${el.e}: closed, radii in [q,Q]`, () => {
      expect(pts).toHaveLength(512);
      expect(pts[511]!).toEqual(pts[0]!);
      for (const p of pts) {
        expect(norm(p)).toBeGreaterThanOrEqual(q - 1e-12);
        expect(norm(p)).toBeLessThanOrEqual(Q + 1e-12);
      }
    });
    it(`e=${el.e}: planar and perihelion at a(1-e)`, () => {
      const h = unit(cross(pts[100]!, pts[101]!));
      for (const p of pts) expect(Math.abs(dot(p, h)) / 1).toBeLessThan(1e-12);
      expect(norm(pts[0]!)).toBeCloseTo(q, 12);
      // perihelion direction = rotation of +x by omega, i, Omega
      const [co, so, ci, si, cO, sO] = [Math.cos(el.omega), Math.sin(el.omega), Math.cos(el.i), Math.sin(el.i), Math.cos(el.Omega), Math.sin(el.Omega)];
      const dir = [cO * co - sO * so * ci, sO * co + cO * so * ci, so * si];
      for (let k = 0; k < 3; k++) expect(pts[0]![k]! / q).toBeCloseTo(dir[k]!, 12);
    });
  }
});

describe('sampleOrbit hyperbola', () => {
  it('returns finite points within the asymptote limit', () => {
    const el: OrbitalElements = { ...base, a: -1.5, e: 1.8 };
    const pts = sampleOrbit(el, 200);
    expect(pts).toHaveLength(200);
    for (const p of pts) for (const c of p) expect(Number.isFinite(c)).toBe(true);
    const q = Math.abs(el.a) * (el.e - 1);
    expect(Math.min(...pts.map(norm))).toBeGreaterThanOrEqual(q - 1e-12);
    expect(Math.max(...pts.map(norm))).toBeLessThanOrEqual(60 + 1e-9);
  });
});

describe('frames', () => {
  it('equatorial north pole has ecliptic z = cos(eps)', () => {
    expect(toDisplay([0, 0, 1])[2]).toBeCloseTo(Math.cos(OBLIQUITY_J2000_RAD), 14);
  });
  it('bodyPositionEcliptic at epoch has |r| = a(1-e cosE) range', () => {
    const r = norm(bodyPositionEcliptic(base, base.epochJd));
    expect(r).toBeGreaterThan(base.a * (1 - base.e) - 1e-9);
    expect(r).toBeLessThan(base.a * (1 + base.e) + 1e-9);
  });
});
