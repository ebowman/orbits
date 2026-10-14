import { describe, expect, it } from 'vitest';
import {
  angularSeparation,
  degToRad,
  formatDec,
  formatRA,
  normalizeRad,
  parseDec,
  parseRA,
  radToDeg,
} from './angles';

describe('angles', () => {
  it('conversions and normalize', () => {
    expect(radToDeg(degToRad(37))).toBeCloseTo(37, 12);
    expect(normalizeRad(-0.5)).toBeCloseTo(2 * Math.PI - 0.5, 14);
    expect(normalizeRad(2 * Math.PI)).toBe(0);
    expect(normalizeRad(7 * Math.PI)).toBeCloseTo(Math.PI, 12);
  });
  it('parseRA formats', () => {
    const expected = ((12 + 30 / 60 + 36 / 3600) * 15 * Math.PI) / 180;
    expect(parseRA('12 30 36')).toBeCloseTo(expected, 14);
    expect(parseRA('12:30:36')).toBeCloseTo(expected, 14);
    expect(parseRA(12 + 30 / 60 + 36 / 3600)).toBeCloseTo(expected, 14);
    expect(parseRA('12.51')).toBeCloseTo(12.51 * 15 * Math.PI / 180, 14);
  });
  it('parseDec formats and sign', () => {
    expect(radToDeg(parseDec('+12 30 36'))).toBeCloseTo(12.51, 12);
    expect(radToDeg(parseDec('-12:30:36'))).toBeCloseTo(-12.51, 12);
    expect(radToDeg(parseDec('-00 30 00'))).toBeCloseTo(-0.5, 12);
    expect(radToDeg(parseDec('-0:30:00'))).toBeCloseTo(-0.5, 12);
    expect(radToDeg(parseDec(-45.25))).toBeCloseTo(-45.25, 12);
    expect(radToDeg(parseDec('90 00 00'))).toBeCloseTo(90, 12);
  });
  it('rejects invalid input', () => {
    expect(() => parseRA('12 60 00')).toThrow(/minutes/);
    expect(() => parseRA('12 30 60')).toThrow(/seconds/);
    expect(() => parseRA('24 00 00')).toThrow(/< 24/);
    expect(() => parseRA(24)).toThrow(/< 24/);
    expect(() => parseRA(-1)).toThrow(/negative/);
    expect(() => parseRA('abc')).toThrow(/invalid number/);
    expect(() => parseRA('')).toThrow(/empty/);
    expect(() => parseDec('10 60 00')).toThrow(/minutes/);
    expect(() => parseDec('10 00 61')).toThrow(/seconds/);
    expect(() => parseDec('91 00 00')).toThrow(/90/);
    expect(() => parseDec('90 00 01')).toThrow(/90/);
    expect(() => parseDec(-90.5)).toThrow(/90/);
    expect(() => parseDec('1 2 3 4')).toThrow(/fields/);
  });
  it('formats', () => {
    expect(formatRA(parseRA('12 30 36.5'), 1)).toBe('12 30 36.5');
    expect(formatRA(parseRA('01 02 03'), 0)).toBe('01 02 03');
    expect(formatRA(parseRA('00 00 00'), 2, ':')).toBe('00:00:00.00');
    expect(formatDec(parseDec('-00 30 00'), 0)).toBe('-00 30 00');
    expect(formatDec(parseDec('+12 30 36.25'), 2)).toBe('+12 30 36.25');
    expect(formatDec(parseDec('-45 00 00'), 1, ':')).toBe('-45:00:00.0');
  });
  it('format rounding carries', () => {
    expect(formatRA(parseRA('23 59 59.99'), 1)).toBe('00 00 00.0');
    expect(formatDec(parseDec('+10 59 59.96'), 1)).toBe('+11 00 00.0');
  });
  it('angularSeparation', () => {
    expect(angularSeparation(0, 0, Math.PI / 2, 0)).toBeCloseTo(Math.PI / 2, 14);
    expect(angularSeparation(1, 0.5, 1, 0.5)).toBe(0);
    expect(angularSeparation(0, 0, Math.PI, 0)).toBeCloseTo(Math.PI, 14);
    expect(angularSeparation(0, Math.PI / 2, 1, -Math.PI / 2)).toBeCloseTo(Math.PI, 14);
    // tiny separation: 1 arcsec stays accurate
    const as = degToRad(1 / 3600);
    expect(angularSeparation(0.3, 0.2, 0.3, 0.2 + as) / as).toBeCloseTo(1, 8);
  });
});
