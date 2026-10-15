import { J2000_JD } from './constants';
import { normalizeRad, DEG2RAD } from './angles';

/** Greenwich mean sidereal time (rad, [0,2π)) at JD(UT1); UT1 ~ UTC (Meeus 12.4). */
export function gmst(jdUt1: number): number {
  const t = (jdUt1 - J2000_JD) / 36525;
  const deg =
    280.46061837 +
    360.98564736629 * (jdUt1 - J2000_JD) +
    0.000387933 * t * t -
    (t * t * t) / 38710000;
  return normalizeRad(deg * DEG2RAD);
}

/** Local mean sidereal time (rad) for east longitude `lonEastRad`. */
export function lst(jd: number, lonEastRad: number): number {
  return normalizeRad(gmst(jd) + lonEastRad);
}
