import { describe, expect, it } from 'vitest';
import { calendarToJd, jdToCalendar, jdUtcToTt, taiMinusUtc, utcToJd } from './time';

describe('time', () => {
  it('Meeus Ex 7.a: 1957 Oct 4.81 -> JD 2436116.31', () => {
    expect(calendarToJd(1957, 10, 4.81)).toBeCloseTo(2436116.31, 8);
  });
  it('J2000 and Date input', () => {
    expect(utcToJd({ year: 2000, month: 1, day: 1, hour: 12 })).toBe(2451545.0);
    expect(utcToJd(new Date(Date.UTC(2000, 0, 1, 12)))).toBeCloseTo(2451545.0, 9);
  });
  it('Julian calendar case (Meeus: 333 Jan 27.5 -> 1842713.0)', () => {
    expect(calendarToJd(333, 1, 27.5)).toBeCloseTo(1842713.0, 8);
  });
  it('round trip', () => {
    const jd = calendarToJd(2024, 2, 29, 13, 45, 12.5);
    const c = jdToCalendar(jd);
    expect([c.year, c.month, c.day, c.hour, c.minute]).toEqual([2024, 2, 29, 13, 45]);
    expect(c.second).toBeCloseTo(12.5, 3);
    const c2 = jdToCalendar(2436116.31);
    expect([c2.year, c2.month, c2.day, c2.hour]).toEqual([1957, 10, 4, 19]);
  });
  it('leap second table', () => {
    expect(taiMinusUtc(calendarToJd(1972, 1, 1))).toBe(10);
    expect(taiMinusUtc(calendarToJd(1972, 6, 30, 23, 59, 59))).toBe(10);
    expect(taiMinusUtc(calendarToJd(1972, 7, 1))).toBe(11);
    expect(taiMinusUtc(calendarToJd(2000, 1, 1))).toBe(32);
    expect(taiMinusUtc(calendarToJd(2016, 12, 31, 12))).toBe(36);
    expect(taiMinusUtc(calendarToJd(2017, 1, 1))).toBe(37);
    expect(taiMinusUtc(calendarToJd(2030, 1, 1))).toBe(37);
  });
  it('UTC -> TT', () => {
    const jd = calendarToJd(2000, 1, 1, 12);
    expect((jdUtcToTt(jd) - jd) * 86400).toBeCloseTo(32 + 32.184, 4);
    const jd2 = calendarToJd(2020, 6, 1);
    expect((jdUtcToTt(jd2) - jd2) * 86400).toBeCloseTo(69.184, 4);
  });
  it('throws before 1972', () => {
    expect(() => jdUtcToTt(calendarToJd(1971, 12, 31))).toThrow(/1972/);
  });
});
