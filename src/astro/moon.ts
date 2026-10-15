/**
 * Low-precision geocentric Moon, Meeus "Astronomical Algorithms" 2nd ed. ch. 47 (truncated).
 * Used only to convert the Standish Earth-Moon barycentre to the geocentre (see planets.ts).
 * Kept: the 32 largest longitude/distance terms (Table 47.A, down to ~2000e-6 deg / ~6 km)
 * and the 14 largest latitude terms (Table 47.B), plus the A1/A2/A3 additive terms.
 * Dropped terms and the omitted nutation limit accuracy to ~10 arcsec (tens of km, test bound 2000 km);
 * the Earth offset divides this by ~82.
 */
import { AU_KM, J2000_JD } from './constants';
import { DEG2RAD } from './angles';
import { rotateX, scale, sub, type Vec3 } from './vec';

/** Moon/Earth mass ratio (DE430): EMB = Earth + moonGeo / (1 + EARTH_MOON_MASS_RATIO). */
export const EARTH_MOON_MASS_RATIO = 81.30056907;

// [D, M, M', F, sumL (1e-6 deg), sumR (1e-3 km)]
const LR: [number, number, number, number, number, number][] = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322],
  [2, -2, 0, 0, 2236, -9884],
];

// [D, M, M', F, sumB (1e-6 deg)]
const B: [number, number, number, number, number][] = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
];

/**
 * Geocentric Moon position, J2000 equatorial (ICRF-aligned), AU. jdTt is TT (TDB differs < 2 ms).
 * Meeus gives ecliptic coordinates referred to the MEAN equinox/ecliptic OF DATE; we rotate to the
 * mean equatorial frame of date (mean obliquity of date, Meeus 22.2) and then precess to J2000
 * with the IAU 1976 angles zeta/z/theta (Meeus 21.2). Nutation is not applied (<= 17", irrelevant here).
 */
export function moonGeocentric(jdTt: number): Vec3 {
  const T = (jdTt - J2000_JD) / 36525;
  const Lp = 218.3164477 + 481267.88123421 * T;
  const D = (297.8501921 + 445267.1114034 * T) * DEG2RAD;
  const M = (357.5291092 + 35999.0502909 * T) * DEG2RAD;
  const Mp = (134.9633964 + 477198.8675055 * T) * DEG2RAD;
  const F = (93.272095 + 483202.0175233 * T) * DEG2RAD;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const A1 = (119.75 + 131.849 * T) * DEG2RAD;
  const A2 = (53.09 + 479264.29 * T) * DEG2RAD;
  const A3 = (313.45 + 481266.484 * T) * DEG2RAD;
  const LpR = Lp * DEG2RAD;

  let sl = 0;
  let sr = 0;
  for (const [d, m, mp, f, cl, cr] of LR) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const ef = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sl += cl * ef * Math.sin(arg);
    sr += cr * ef * Math.cos(arg);
  }
  let sb = 0;
  for (const [d, m, mp, f, cb] of B) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const ef = Math.abs(m) === 1 ? E : Math.abs(m) === 2 ? E * E : 1;
    sb += cb * ef * Math.sin(arg);
  }
  sl += 3958 * Math.sin(A1) + 1962 * Math.sin(LpR - F) + 318 * Math.sin(A2);
  sb += -2235 * Math.sin(LpR) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F) + 175 * Math.sin(A1 + F)
    + 127 * Math.sin(LpR - Mp) - 115 * Math.sin(LpR + Mp);

  const lam = (Lp + sl / 1e6) * DEG2RAD;
  const bet = (sb / 1e6) * DEG2RAD;
  const distAu = (385000.56 + sr / 1000) / AU_KM;
  const ecl: Vec3 = [
    distAu * Math.cos(bet) * Math.cos(lam),
    distAu * Math.cos(bet) * Math.sin(lam),
    distAu * Math.sin(bet),
  ];

  // mean ecliptic of date -> mean equatorial of date
  const epsDate = (84381.448 - 46.815 * T - 0.00059 * T * T) / 3600 * DEG2RAD;
  const eqDate = rotateX(ecl, epsDate);
  // precess mean equatorial of date -> J2000 (transpose of Meeus 21.4 matrix, J2000 -> date)
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) / 3600 * DEG2RAD;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) / 3600 * DEG2RAD;
  const th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) / 3600 * DEG2RAD;
  const [cz, sz, cx, sx, ct, st] = [Math.cos(zeta), Math.sin(zeta), Math.cos(z), Math.sin(z), Math.cos(th), Math.sin(th)];
  const P = [
    [cz * ct * cx - sz * sx, -sz * ct * cx - cz * sx, -st * cx],
    [cz * ct * sx + sz * cx, -sz * ct * sx + cz * cx, -st * sx],
    [cz * st, -sz * st, ct],
  ];
  const [x, y, w] = eqDate;
  // v_J2000 = P^T v_date
  return [
    P[0]![0]! * x + P[1]![0]! * y + P[2]![0]! * w,
    P[0]![1]! * x + P[1]![1]! * y + P[2]![1]! * w,
    P[0]![2]! * x + P[1]![2]! * y + P[2]![2]! * w,
  ];
}

/** Geocentric Moon velocity, AU/day, by central difference of {@link moonGeocentric} over +-0.01 d. */
export function moonGeocentricVelocity(jdTt: number): Vec3 {
  const h = 0.01;
  return scale(sub(moonGeocentric(jdTt + h), moonGeocentric(jdTt - h)), 1 / (2 * h));
}

/** Offset EMB - Earth centre (AU, AU/day) = moonGeo / (1 + mass ratio). Subtract it from the EMB state. */
export function embMinusEarth(jdTt: number): { r: Vec3; v: Vec3 } {
  const k = 1 / (1 + EARTH_MOON_MASS_RATIO);
  return { r: scale(moonGeocentric(jdTt), k), v: scale(moonGeocentricVelocity(jdTt), k) };
}
