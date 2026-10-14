import { describe, expect, it } from 'vitest';
import { gmst, lst } from './sidereal';
import { calendarToJd } from './time';

describe('sidereal', () => {
  it('Meeus Ex 12.a: 1987 Apr 10 0h UT -> 13h10m46.3668s (within 0.01 s)', () => {
    const jd = calendarToJd(1987, 4, 10);
    expect(jd).toBe(2446895.5);
    const seconds = (gmst(jd) / (2 * Math.PI)) * 86400;
    expect(Math.abs(seconds - (13 * 3600 + 10 * 60 + 46.3668))).toBeLessThan(0.01);
  });
  it('lst adds east longitude and wraps', () => {
    const jd = calendarToJd(1987, 4, 10);
    expect(lst(jd, 0)).toBeCloseTo(gmst(jd), 14);
    const l = lst(jd, -0.5);
    expect(l).toBeGreaterThanOrEqual(0);
    expect(l).toBeLessThan(2 * Math.PI);
    expect(lst(jd, 6)).toBeCloseTo((gmst(jd) + 6) % (2 * Math.PI), 12);
  });
});
