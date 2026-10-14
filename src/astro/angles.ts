export const TWO_PI = 2 * Math.PI;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const degToRad = (d: number): number => d * DEG2RAD;
export const radToDeg = (r: number): number => r * RAD2DEG;

/** Normalize an angle to [0, 2π). */
export function normalizeRad(a: number): number {
  const r = a % TWO_PI;
  const v = r < 0 ? r + TWO_PI : r;
  return v >= TWO_PI ? 0 : v;
}

/** Normalize an angle in degrees to [0, 360). */
export function normalizeDeg(a: number): number {
  const r = a % 360;
  const v = r < 0 ? r + 360 : r;
  return v >= 360 ? 0 : v;
}

interface Sexagesimal {
  negative: boolean;
  value: number; // absolute value in the leading unit (hours or degrees)
}

function parseSexagesimal(input: string, what: string): Sexagesimal {
  const s = input.trim();
  if (s === '') throw new Error(`${what}: empty input`);
  const negative = s.startsWith('-');
  const body = s.replace(/^[+-]/, '').trim();
  const parts = body.split(/[\s:]+/).filter((p) => p !== '');
  if (parts.length < 1 || parts.length > 3) {
    throw new Error(`${what}: cannot parse "${input}" (expected 1 to 3 fields)`);
  }
  const nums = parts.map((p) => {
    if (!/^\d+(\.\d*)?$|^\.\d+$/.test(p)) {
      throw new Error(`${what}: invalid number "${p}" in "${input}"`);
    }
    return Number(p);
  });
  const [a, b = 0, c = 0] = nums as [number, number?, number?];
  if (parts.length >= 2 && !/^\d+$/.test(parts[0] as string)) {
    throw new Error(`${what}: leading field must be an integer in "${input}"`);
  }
  if (parts.length === 3 && !/^\d+$/.test(parts[1] as string)) {
    throw new Error(`${what}: minutes must be an integer in "${input}"`);
  }
  if (b >= 60) throw new Error(`${what}: minutes must be < 60 in "${input}"`);
  if (c >= 60) throw new Error(`${what}: seconds must be < 60 in "${input}"`);
  return { negative, value: a + b / 60 + c / 3600 };
}

/** Parse RA ('hh mm ss.s', 'hh:mm:ss.s', or decimal hours) to radians in [0, 2π). */
export function parseRA(input: string | number): number {
  let hours: number;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('parseRA: non-finite input');
    hours = input;
  } else {
    const p = parseSexagesimal(input, 'parseRA');
    if (p.negative) throw new Error(`parseRA: RA must not be negative: "${input}"`);
    hours = p.value;
  }
  if (hours < 0) throw new Error(`parseRA: RA must not be negative: ${hours}`);
  if (hours >= 24) throw new Error(`parseRA: hours must be < 24, got ${hours}`);
  return hours * 15 * DEG2RAD;
}

/** Parse Dec ('±dd mm ss', '±dd:mm:ss', or decimal degrees) to radians. */
export function parseDec(input: string | number): number {
  let deg: number;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('parseDec: non-finite input');
    deg = input;
  } else {
    const p = parseSexagesimal(input, 'parseDec');
    deg = p.negative ? -p.value : p.value;
  }
  if (Math.abs(deg) > 90) throw new Error(`parseDec: |Dec| must be <= 90 degrees, got ${deg}`);
  return deg * DEG2RAD;
}

/** Split a non-negative value into d/m/s with rounding carry at given seconds precision. */
function split(value: number, precision: number): [number, number, number] {
  const factor = 10 ** precision;
  let total = Math.round(value * 3600 * factor); // in units of 10^-precision seconds
  const perMin = 60 * factor;
  const perDeg = 3600 * factor;
  const d = Math.floor(total / perDeg);
  total -= d * perDeg;
  const m = Math.floor(total / perMin);
  total -= m * perMin;
  return [d, m, total / factor];
}

const pad = (n: number, w: number): string => String(n).padStart(w, '0');

function fmtSec(sec: number, precision: number): string {
  const s = sec.toFixed(precision);
  return precision > 0 ? s.padStart(3 + precision, '0') : s.padStart(2, '0');
}

/** Format RA radians as 'hh mm ss.s'. */
export function formatRA(ra: number, precision = 1, sep = ' '): string {
  const hours = (normalizeRad(ra) * RAD2DEG) / 15;
  let [h, m, s] = split(hours, precision);
  if (h >= 24) {
    [h, m, s] = [0, 0, 0];
  }
  return `${pad(h, 2)}${sep}${pad(m, 2)}${sep}${fmtSec(s, precision)}`;
}

/** Format Dec radians as '±dd mm ss.s'. */
export function formatDec(dec: number, precision = 0, sep = ' '): string {
  const deg = dec * RAD2DEG;
  const [d, m, s] = split(Math.abs(deg), precision);
  const neg = deg < 0 && d + m + s > 0;
  return `${neg ? '-' : '+'}${pad(d, 2)}${sep}${pad(m, 2)}${sep}${fmtSec(s, precision)}`;
}

/** Angular separation (rad) between two RA/Dec positions (Vincenty form, stable at all angles). */
export function angularSeparation(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const dra = ra2 - ra1;
  const cd1 = Math.cos(dec1);
  const cd2 = Math.cos(dec2);
  const sd1 = Math.sin(dec1);
  const sd2 = Math.sin(dec2);
  const x = cd1 * sd2 - sd1 * cd2 * Math.cos(dra);
  const y = cd2 * Math.sin(dra);
  const z = sd1 * sd2 + cd1 * cd2 * Math.cos(dra);
  return Math.atan2(Math.hypot(x, y), z);
}
