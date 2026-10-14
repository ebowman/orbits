import { describe, expect, it } from 'vitest';
import { OBLIQUITY_J2000_RAD } from './constants';
import { eclipticToEquatorial, equatorialToEcliptic, radecToUnit, unitToRadec } from './frames';
import { norm, type Vec3 } from './vec';

describe('frames', () => {
  it('ecliptic <-> equatorial round trip', () => {
    const v: Vec3 = [0.3, -1.2, 0.8];
    const r = equatorialToEcliptic(eclipticToEquatorial(v));
    for (let i = 0; i < 3; i++) expect(r[i]).toBeCloseTo(v[i]!, 14);
  });
  it('ecliptic pole maps to equatorial at dec = 90 - eps', () => {
    const { dec, ra } = unitToRadec(eclipticToEquatorial([0, 0, 1]));
    expect(dec).toBeCloseTo(Math.PI / 2 - OBLIQUITY_J2000_RAD, 14);
    expect(ra).toBeCloseTo(1.5 * Math.PI, 14);
  });
  it('X axis unchanged', () => {
    expect(eclipticToEquatorial([1, 0, 0])).toEqual([1, 0, 0]);
  });
  it('radec round trip', () => {
    for (const [ra, dec] of [[0.1, 0.2], [3.5, -1.0], [6.2, 1.5]] as const) {
      const u = radecToUnit(ra, dec);
      expect(norm(u)).toBeCloseTo(1, 14);
      const o = unitToRadec(u);
      expect(o.ra).toBeCloseTo(ra, 13);
      expect(o.dec).toBeCloseTo(dec, 13);
    }
  });
  it('unitToRadec wraps negative RA and rejects zero', () => {
    expect(unitToRadec([1, -1, 0]).ra).toBeCloseTo(1.75 * Math.PI, 14);
    expect(() => unitToRadec([0, 0, 0])).toThrow();
  });
});
