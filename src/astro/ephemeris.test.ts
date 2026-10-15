import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { predict } from './ephemeris';
import { hgMagnitude } from './magnitude';
import { loadCatalog } from './catalog';
import { angularSeparation, DEG2RAD } from './angles';
import type { Site } from './observer';

type Row = { jdUtc: number; raDeg: number; decDeg: number; deltaAu: number };
type Fixture = { rows: Row[]; site?: Site };

// readFileSync throws on a missing file, so an absent fixture FAILS the test (never skips).
function load(name: string): Fixture {
  const url = new URL(`../../tests/fixtures/horizons/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as Fixture;
}

const toArcsec = (rad: number): number => rad * (180 / Math.PI) * 3600;

const cat = loadCatalog();
const bodyOf = (id: string) => {
  const e = cat.find((c) => c.id === id);
  if (!e) throw new Error(`catalog missing ${id}`);
  return e.body;
};
const BODIES = [
  { name: 'ceres', id: '1' },
  { name: 'vesta', id: '4' },
  { name: 'eros', id: '433' },
];

describe('predict vs Horizons fixtures', () => {
  for (const b of BODIES) {
    for (const kind of ['geocentric', '568'] as const) {
      it(`${b.name}-${kind} within 60 arcsec (every 5th row)`, () => {
        const fx = load(`${b.name}-${kind}`);
        expect(fx.rows.length).toBeGreaterThan(5);
        if (kind === '568') expect(fx.site).toBeDefined();
        const site = kind === '568' ? (fx.site as Site) : null;
        let maxErr = 0;
        let maxRel = 0;
        fx.rows.forEach((row, k) => {
          if (k % 5 !== 0) return;
          const p = predict(bodyOf(b.id), row.jdUtc, site);
          const err = toArcsec(angularSeparation(p.raRad, p.decRad, row.raDeg * DEG2RAD, row.decDeg * DEG2RAD));
          maxErr = Math.max(maxErr, err);
          maxRel = Math.max(maxRel, Math.abs(p.deltaAu - row.deltaAu) / row.deltaAu);
          expect(err, `row ${k} jd ${row.jdUtc}`).toBeLessThan(60);
        });
        console.info(`${b.name}-${kind}: max error ${maxErr.toFixed(2)} arcsec, max delta rel error ${maxRel.toExponential(2)}`);
        expect(maxRel).toBeLessThan(1e-3);
      });
    }
  }

  it('Eros topocentric-minus-geocentric offset matches Horizons within 1.5 arcsec', () => {
    const geo = load('eros-geocentric');
    const top = load('eros-568');
    const site = top.site as Site;
    expect(site).toBeDefined();
    expect(top.rows.length).toBe(geo.rows.length);
    const body = bodyOf('433');
    let maxDiff = 0;
    let maxOff = 0;
    geo.rows.forEach((g, k) => {
      if (k % 5 !== 0) return;
      const t = top.rows[k] as Row;
      expect(t.jdUtc).toBe(g.jdUtc);
      const pg = predict(body, g.jdUtc, null);
      const pt = predict(body, g.jdUtc, site);
      const cosd = Math.cos(g.decDeg * DEG2RAD);
      const wrap = (d: number) => ((d + 540) % 360) - 180;
      const hRa = wrap(t.raDeg - g.raDeg) * cosd * 3600;
      const hDec = (t.decDeg - g.decDeg) * 3600;
      const wrapR = (d: number) => ((d + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      const oRa = toArcsec(wrapR(pt.raRad - pg.raRad)) * cosd;
      const oDec = toArcsec(pt.decRad - pg.decRad);
      maxDiff = Math.max(maxDiff, Math.abs(oRa - hRa), Math.abs(oDec - hDec));
      maxOff = Math.max(maxOff, Math.hypot(hRa, hDec));
    });
    console.info(`eros offset: max |ours - Horizons| ${maxDiff.toFixed(3)} arcsec (max offset magnitude ${maxOff.toFixed(1)} arcsec)`);
    expect(maxOff).toBeGreaterThan(5); // offset must be large enough for the test to be meaningful
    expect(maxDiff).toBeLessThan(1.5);
  });

  it('predicts planets via the planets module', () => {
    const mars = cat.find((c) => c.id === 'mars');
    expect(mars?.kind).toBe('planet');
    const p = predict((mars as { body: Parameters<typeof predict>[0] }).body, 2461200.5, null);
    expect(p.deltaAu).toBeGreaterThan(0.3);
    expect(p.deltaAu).toBeLessThan(2.7);
    expect(p.lightTimeDays).toBeCloseTo(p.deltaAu / 173.1446326846693, 6);
  });
});

describe('hgMagnitude', () => {
  it('zero phase: V = H + 5 log10(r delta)', () => {
    // H=10, r=2, delta=1 -> 10 + 5 log10(2) = 11.50514997831990
    expect(hgMagnitude(10, 0.15, 2, 1, 0)).toBeCloseTo(11.5051499783, 9);
  });
  it('alpha = 90 deg, G = 0.15, r = delta = 1 (hand computed)', () => {
    // tan(45deg) = 1 -> phi1 = exp(-3.33) = 0.035793, phi2 = exp(-1.87) = 0.154124
    // mix = 0.85*0.035793 + 0.15*0.154124 = 0.030424 + 0.023119 = 0.053543
    // V = 5 - 2.5 log10(0.053543) = 5 + 3.1782 = 8.1782 (H = 5)
    const phi1 = Math.exp(-3.33);
    const phi2 = Math.exp(-1.87);
    expect(phi1).toBeCloseTo(0.035793, 5);
    expect(phi2).toBeCloseTo(0.154124, 5);
    expect(hgMagnitude(5, 0.15, 1, 1, Math.PI / 2)).toBeCloseTo(8.1782, 3);
  });
});
