import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(__dirname, 'horizons');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

describe('horizons fixtures', () => {
  it('contains the expected files', () => {
    for (const b of ['ceres', 'vesta', 'eros']) {
      expect(files).toContain(`${b}-geocentric.json`);
      expect(files).toContain(`${b}-568.json`);
    }
    expect(files).toContain('earth.json');
    expect(files).toContain('earth-ceres-opposition.json');
    for (const b of ['ceres', 'vesta', 'eros']) {
      expect(files).toContain(`${b}-opposition-geocentric.json`);
      expect(files).toContain(`${b}-opposition-568.json`);
      expect(files).toContain(`${b}-opposition-elements.json`);
    }
  });

  for (const f of files.filter((x) => x.endsWith('-opposition-elements.json'))) {
    it(`${f} has osculating elements for both triplets`, () => {
      const j = load(f);
      expect(typeof j.purpose).toBe('string');
      expect(j.rows.map((r: { spacingDays: number }) => r.spacingDays)).toEqual([10, 5]);
      for (const r of j.rows) {
        for (const k of ['jdUtcMid', 'jdTdb', 'a', 'e', 'iDeg', 'OmegaDeg', 'omegaDeg', 'MDeg']) {
          expect(Number.isFinite(r[k]), k).toBe(true);
        }
        expect(r.a).toBeGreaterThan(0);
        expect(r.e).toBeGreaterThanOrEqual(0);
        expect(r.e).toBeLessThan(1);
      }
    });
  }

  for (const f of files.filter((x) => !['earth.json', 'earth-ceres-opposition.json'].includes(x) && !x.endsWith('-elements.json'))) {
    it(`${f} observer rows are valid`, () => {
      const j = load(f);
      expect(j.timeScale).toBe('UTC');
      expect(typeof j.query).toBe('string');
      expect(j.rows.length).toBeGreaterThanOrEqual(40);
      if (f.includes('-opposition-')) expect(typeof j.purpose).toBe('string');
      for (const r of j.rows) {
        expect(r.jdUtc).toBeGreaterThan(2400000);
        expect(r.raDeg).toBeGreaterThanOrEqual(0);
        expect(r.raDeg).toBeLessThan(360);
        expect(r.decDeg).toBeGreaterThanOrEqual(-90);
        expect(r.decDeg).toBeLessThanOrEqual(90);
        expect(r.deltaAu).toBeGreaterThan(0);
      }
      if (f.endsWith('-568.json')) {
        expect(j.site.latDeg).toBeGreaterThan(19);
        expect(j.site.latDeg).toBeLessThan(21);
        expect(j.site.lonEastDeg).toBeGreaterThan(200);
        expect(j.site.elevM).toBeGreaterThan(4000);
      }
    });
  }

  it('earth.json has yearly state vectors', () => {
    const j = load('earth.json');
    expect(j.rows.length).toBeGreaterThanOrEqual(50);
    for (const r of j.rows) {
      for (const k of ['jdTdb', 'x', 'y', 'z', 'vx', 'vy', 'vz']) {
        expect(Number.isFinite(r[k]), k).toBe(true);
      }
      expect(Math.hypot(r.x, r.y, r.z)).toBeGreaterThan(0.9);
      expect(Math.hypot(r.x, r.y, r.z)).toBeLessThan(1.1);
    }
  });

  it('earth-ceres-opposition.json has 41 daily Earth rows aligned to UTC days', () => {
    const j = load('earth-ceres-opposition.json');
    expect(j.rows.length).toBe(41);
    j.rows.forEach((r: Record<string, number>, k: number) => {
      for (const key of ['jdUtc', 'jdTdb', 'x', 'y', 'z', 'vx', 'vy', 'vz']) {
        expect(Number.isFinite(r[key]), `${key} row ${k}`).toBe(true);
      }
      const rad = Math.hypot(r.x!, r.y!, r.z!);
      expect(rad).toBeGreaterThan(0.9);
      expect(rad).toBeLessThan(1.1);
      expect(r.jdUtc).toBe(2461410.5 + k);
      expect(Math.abs(r.jdTdb! - r.jdUtc! - 69.184 / 86400)).toBeLessThan(1e-9);
    });
  });
});
