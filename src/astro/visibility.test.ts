import { describe, expect, it } from 'vitest';
import {
  DEG2RAD,
  bodyVisibility,
  calendarToJd,
  darkWindow,
  equatorialToHorizontal,
  loadCatalog,
  lst,
  predict,
  suggestPlan,
  type Site,
} from '@astro';

const mk: Site = { latDeg: 19.8260847, lonEastDeg: 204.5278, elevM: 4210 };
const vesta = loadCatalog().find((c) => c.name === 'Vesta')!;

describe('visibility', () => {
  it('Vesta altitude matches equatorialToHorizontal(predict())', () => {
    const w = darkWindow(mk, { year: 2026, month: 11, day: 20 })!;
    expect(w).not.toBeNull();
    const v = bodyVisibility(vesta, mk, w)!;
    const p = predict(vesta.body, v.jdMaxAlt, mk);
    const hz = equatorialToHorizontal(p.raRad, p.decRad, lst(v.jdMaxAlt, mk.lonEastDeg * DEG2RAD), mk.latDeg * DEG2RAD);
    expect(v.maxAltRad).toBeCloseTo(hz.alt, 12);
    expect(v.raRad).toBeCloseTo(p.raRad, 12);
    expect(v.v).not.toBeNull();
    expect(v.jdMaxAlt).toBeGreaterThanOrEqual(w.startJd);
    expect(v.jdMaxAlt).toBeLessThanOrEqual(w.endJd);
  });

  it('longitude convention does not change the window', () => {
    const d = { year: 2026, month: 11, day: 20 };
    expect(darkWindow(mk, d)).toEqual(darkWindow({ ...mk, lonEastDeg: -155.4722 }, d));
  });

  it('Hawaii 2026-11-20 night is the evening of Nov 20 local (Nov 21 UTC)', () => {
    const w = darkWindow(mk, { year: 2026, month: 11, day: 20 })!;
    const j = (d: number, h: number, m = 0) => calendarToJd(2026, 11, d, h, m, 0);
    expect(w.startJd).toBeGreaterThan(j(21, 4));
    expect(w.startJd).toBeLessThan(j(21, 6));
    expect(w.endJd).toBeGreaterThan(j(21, 14, 30));
    expect(w.endJd).toBeLessThan(j(21, 16));
  });

  it('mid-latitude November dark window has a plausible length', () => {
    const w = darkWindow({ latDeg: 40, lonEastDeg: -105, elevM: 0 }, { year: 2026, month: 11, day: 20 })!;
    const h = (w.endJd - w.startJd) * 24;
    expect(h).toBeGreaterThan(6);
    expect(h).toBeLessThan(14);
  });

  it('polar day -> null, polar night -> ~24 h, no throw', () => {
    const p: Site = { latDeg: 78, lonEastDeg: 15, elevM: 0 };
    expect(darkWindow(p, { year: 2026, month: 6, day: 25 })).toBeNull();
    // At 78N the midwinter Sun only reaches about -11 deg (> -18), so darkness is not continuous.
    const w78 = darkWindow(p, { year: 2026, month: 12, day: 25 })!;
    expect((w78.endJd - w78.startJd) * 24).toBeGreaterThan(12);
    // Sun stays below -18 deg all day only at higher latitude (85N: noon alt about -18.0 - margin).
    const w = darkWindow({ latDeg: 89, lonEastDeg: 15, elevM: 0 }, { year: 2026, month: 12, day: 25 })!;
    expect((w.endJd - w.startJd) * 24).toBeCloseTo(24, 6);
    const ph = suggestPlan(vesta, p, { year: 2026, month: 6, day: 25 });
    expect(ph.every((n) => n.best === null)).toBe(true);
  });

  it('suggestPlan gives 3 nights spaced correctly', () => {
    const plan = suggestPlan(vesta, mk, { year: 2026, month: 11, day: 20 }, 7);
    expect(plan.map((n) => n.date.day + n.date.month * 100)).toEqual([1120, 1127, 1204]);
    const b = plan[0]!.best;
    for (const n of plan) {
      if (n.best) {
        expect(n.best.jd).toBeGreaterThanOrEqual(n.window!.startJd);
        expect(n.best.jd).toBeLessThanOrEqual(n.window!.endJd);
      }
    }
    expect(plan[0]!.window!.startJd).toBeGreaterThan(calendarToJd(2026, 11, 21, 4, 0, 0));
    expect(plan[1]!.window!.startJd - plan[0]!.window!.startJd).toBeCloseTo(7, 1);
    expect(b).not.toBeNull();
  });
});
