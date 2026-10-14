import { describe, expect, it } from 'vitest';
import { degToRad, parseRA, radToDeg } from './angles';
import { equatorialToHorizontal } from './horizon';

describe('horizon', () => {
  it('Meeus Ex 13.b: Venus at USNO 1987 Apr 10 19h21m00s UT (within 0.01 deg)', () => {
    // Venus: RA 23h09m16.641s, Dec -6deg43'11.61"; observer lat +38deg55'17" N.
    // Meeus gives local hour angle H = 64.352133 deg, so LST = RA + H (avoids nutation ambiguity).
    const ra = parseRA('23 09 16.641');
    const dec = -degToRad(6 + 43 / 60 + 11.61 / 3600);
    const lat = degToRad(38 + 55 / 60 + 17 / 3600);
    const lstRad = ra + degToRad(64.352133);
    const { alt, az } = equatorialToHorizontal(ra, dec, lstRad, lat);
    expect(radToDeg(alt)).toBeCloseTo(15.1249, 2);
    // Meeus azimuth 68.0337 deg is measured from South; from North it is +180.
    expect(Math.abs(radToDeg(az) - (68.0337 + 180))).toBeLessThan(0.01);
  });
  it('cardinal sanity', () => {
    // Object on the meridian south of zenith at lat 45N: dec 0 -> alt 45, az 180.
    const r = equatorialToHorizontal(1, 0, 1, degToRad(45));
    expect(radToDeg(r.alt)).toBeCloseTo(45, 10);
    expect(radToDeg(r.az)).toBeCloseTo(180, 10);
    // Pole star at north pole altitude = lat, az 0.
    const p = equatorialToHorizontal(0, Math.PI / 2, 2, degToRad(45));
    expect(radToDeg(p.alt)).toBeCloseTo(45, 10);
    expect(Math.min(radToDeg(p.az), 360 - radToDeg(p.az))).toBeCloseTo(0, 8);
    // Object with positive hour angle (west of meridian) at dec 0 has az in (180,360).
    const w = equatorialToHorizontal(0, 0, 0.5, degToRad(45));
    expect(radToDeg(w.az)).toBeGreaterThan(180);
  });
});
