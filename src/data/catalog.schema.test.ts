import { describe, it, expect } from 'vitest';
import catalog from './catalog.json';

type Entry = Record<string, unknown>;
const entries = catalog as Entry[];
const asteroids = entries.filter((e) => e.kind === 'asteroid');
const planets = entries.filter((e) => e.kind === 'planet');

describe('catalog.json schema', () => {
  it('has the 8 asteroids and 3 planets', () => {
    expect(asteroids.map((a) => a.id)).toEqual(['1', '2', '3', '4', '6', '7', '10', '433']);
    expect(planets.map((p) => p.id)).toEqual(['mars', 'jupiter', 'saturn']);
  });

  it.each(asteroids)('asteroid $name has valid elements', (a) => {
    for (const k of ['epochJdTt', 'a', 'e', 'iDeg', 'OmegaDeg', 'omegaDeg', 'MDeg', 'H', 'G']) {
      expect(typeof a[k], k).toBe('number');
      expect(Number.isFinite(a[k]), k).toBe(true);
    }
    expect(a.source).toBe('JPL SBDB');
    expect(Number.isNaN(Date.parse(a.fetchedAt as string))).toBe(false);
    expect(a.e as number).toBeGreaterThanOrEqual(0);
    expect(a.e as number).toBeLessThan(1);
    expect(a.a as number).toBeGreaterThan(0);
    expect(a.a as number).toBeLessThan(10);
    for (const k of ['iDeg', 'OmegaDeg', 'omegaDeg', 'MDeg']) {
      expect(a[k] as number, k).toBeGreaterThanOrEqual(0);
      expect(a[k] as number, k).toBeLessThan(360);
    }
    expect(a.epochJdTt as number).toBeGreaterThan(2400000);
    expect(a.G as number).toBeGreaterThanOrEqual(0);
  });

  it.each(planets)('planet $id has no elements', (p) => {
    expect(p.source).toBe('Standish');
    expect(p.a).toBeUndefined();
  });
});
