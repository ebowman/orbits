import { describe, expect, it } from 'vitest';
import moonFixture from '../../tests/fixtures/horizons/moon-geocentric.json';
import earthWindow from '../../tests/fixtures/horizons/earth-ceres-opposition.json';
import { AU_KM } from './constants';
import { earthHeliocentric } from './planets';
import { moonGeocentric, moonGeocentricVelocity } from './moon';
import { norm, sub } from './vec';

describe('moon (Meeus ch.47 truncated)', () => {
  it('matches Horizons geocentric Moon within 2000 km on all fixture dates', () => {
    let max = 0;
    let maxV = 0;
    for (const row of moonFixture.rows) {
      const r = moonGeocentric(row.jdTdb);
      max = Math.max(max, norm(sub(r, [row.x, row.y, row.z])) * AU_KM);
      maxV = Math.max(maxV, norm(sub(moonGeocentricVelocity(row.jdTdb), [row.vx, row.vy, row.vz])));
    }
    console.log(`Moon max pos err ${max.toFixed(1)} km, max vel err ${maxV} AU/day`);
    expect(max).toBeLessThan(2000);
    expect(maxV).toBeLessThan(1e-6); // Moon speed ~6.6e-3 AU/day; measured 2.2e-7
  });
});

describe('earthHeliocentric (EMB corrected to geocentre) vs Horizons Ceres-window fixture', () => {
  it('max position error over 41 rows < 1.5e-5 AU; velocity improved vs EMB (7.7e-6)', () => {
    let maxP = 0;
    let maxV = 0;
    for (const row of earthWindow.rows) {
      const s = earthHeliocentric(row.jdTdb);
      maxP = Math.max(maxP, norm(sub(s.r, [row.x, row.y, row.z])));
      maxV = Math.max(maxV, norm(sub(s.v, [row.vx, row.vy, row.vz])));
    }
    console.log(`Earth window max pos err ${maxP} AU, max vel err ${maxV} AU/day`);
    expect(maxP).toBeLessThan(1.5e-5);
    expect(maxV).toBeLessThan(1e-6); // EMB-only was 7.7e-6; measured 3.6e-7
  });
});
