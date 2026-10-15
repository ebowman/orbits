import { describe, expect, it } from 'vitest';
import earthFixture from '../../tests/fixtures/horizons/earth.json';
import { AU_KM, J2000_JD } from './constants';
import { DEG2RAD, RAD2DEG, normalizeDeg } from './angles';
import { unitToRadec } from './frames';
import { earthHeliocentric, planetHeliocentric, PLANET_JD_MAX, PLANET_JD_MIN } from './planets';
import { observerGeocentric, observerHeliocentric } from './observer';
import { norm, scale, sub, unit } from './vec';

describe('planets', () => {
  it('Earth speed ~0.0172 AU/day and distance ~1 AU', () => {
    const { r, v } = earthHeliocentric(J2000_JD);
    expect(norm(v)).toBeGreaterThan(0.0167);
    expect(norm(v)).toBeLessThan(0.0175);
    expect(Math.abs(norm(r) - 0.983)).toBeLessThan(0.002);
  });

  it('matches Horizons Earth fixture (pos < 2e-4 AU, vel < 1e-5 AU/day)', () => {
    let maxP = 0;
    let maxV = 0;
    for (const row of earthFixture.rows) {
      // TDB vs TT differ by < 2 ms; ignored.
      const s = earthHeliocentric(row.jdTdb);
      maxP = Math.max(maxP, norm(sub(s.r, [row.x, row.y, row.z])));
      maxV = Math.max(maxV, norm(sub(s.v, [row.vx, row.vy, row.vz])));
    }
    console.log(`Earth max pos err ${maxP} AU, max vel err ${maxV} AU/day`);
    expect(maxP).toBeLessThan(2e-4);
    // EMB vs Earth: the Moon's ~12 m/s reflex velocity is ~7e-6 AU/day, so velocity floor is ~8.5e-6.
    expect(maxV).toBeLessThan(1e-5);
  });

  it('Sun geocentric RA/Dec vs Meeus Ex. 25.a (1992 Oct 13 0h TD)', () => {
    // Meeus 25.a gives APPARENT coords of date: RA 13h13m31.4s, Dec -7d47'06".
    // Ours is J2000 astrometric, so precess to the mean equinox of date (Meeus 21.2) first.
    const jd = 2448908.5;
    const { r } = earthHeliocentric(jd);
    const { ra, dec } = unitToRadec(unit(scale(r, -1)));
    const T = (jd - J2000_JD) / 36525;
    const zeta = (2306.2181 * T + 0.30188 * T * T) / 3600 * DEG2RAD;
    const z = (2306.2181 * T + 1.09468 * T * T) / 3600 * DEG2RAD;
    const th = (2004.3109 * T - 0.42665 * T * T) / 3600 * DEG2RAD;
    const A = Math.cos(dec) * Math.sin(ra + zeta);
    const B = Math.cos(th) * Math.cos(dec) * Math.cos(ra + zeta) - Math.sin(th) * Math.sin(dec);
    const C = Math.sin(th) * Math.cos(dec) * Math.cos(ra + zeta) + Math.cos(th) * Math.sin(dec);
    const raDate = normalizeDeg((Math.atan2(A, B) + z) * RAD2DEG);
    const decDate = Math.asin(C) * RAD2DEG;
    const raRef = (13 + 13 / 60 + 31.4 / 3600) * 15;
    const decRef = -(7 + 47 / 60 + 6 / 3600);
    // Residual from nutation/aberration (~0.005 deg each) and EMB-vs-Earth is within tolerance.
    expect(Math.abs(raDate - raRef)).toBeLessThan(0.02);
    expect(Math.abs(decDate - decRef)).toBeLessThan(0.02);
  });

  it('every planet gives a plausible heliocentric distance at J2000', () => {
    const expected: Record<string, number> = { Mercury: 0.4, Venus: 0.72, Mars: 1.4, Jupiter: 4.97, Saturn: 9.18, Uranus: 19.9, Neptune: 30.1 };
    for (const [n, d] of Object.entries(expected)) {
      const { r } = planetHeliocentric(n as 'Mars', J2000_JD);
      expect(Math.abs(norm(r) - d) / d).toBeLessThan(0.2);
    }
  });

  it('throws outside 1800-2050', () => {
    expect(() => earthHeliocentric(PLANET_JD_MIN - 1)).toThrow();
    expect(() => earthHeliocentric(PLANET_JD_MAX + 1)).toThrow();
  });
});

describe('observer', () => {
  const eq = { latDeg: 0, lonEastDeg: 0, elevM: 0 };
  it('equator site has |offset| ~ 6378 km', () => {
    const km = norm(observerGeocentric(eq, 2460000.5)) * AU_KM;
    expect(km).toBeCloseTo(6378.137, 2);
  });
  it('pole site is ~6356.752 km on the z axis', () => {
    const v = observerGeocentric({ latDeg: 90, lonEastDeg: 0, elevM: 0 }, 2460000.5);
    expect(v[2] * AU_KM).toBeCloseTo(6356.752, 2);
    expect(Math.hypot(v[0], v[1]) * AU_KM).toBeLessThan(1e-6);
  });
  it('elevation adds radially at equator', () => {
    const km = norm(observerGeocentric({ ...eq, elevM: 1000 }, 2460000.5)) * AU_KM;
    expect(km).toBeCloseTo(6379.137, 2);
  });
  it('observerHeliocentric: null site is geocenter; site adds offset', () => {
    const jd = 2460000.5;
    const g = observerHeliocentric(null, jd, jd);
    expect(g).toEqual(earthHeliocentric(jd).r);
    const s = observerHeliocentric(eq, jd, jd);
    expect(norm(sub(s, g)) * AU_KM).toBeCloseTo(6378.137, 2);
  });
});
