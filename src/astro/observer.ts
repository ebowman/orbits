import { AU_KM, EARTH_FLATTENING, EARTH_RADIUS_KM } from './constants';
import { DEG2RAD } from './angles';
import { lst } from './sidereal';
import { earthHeliocentric } from './planets';
import { add, rotateZ, type Vec3 } from './vec';
import type { StateVector } from './state';

export type Site = { latDeg: number; lonEastDeg: number; elevM: number };

/**
 * Observer position relative to the geocenter, in AU, J2000 equatorial axes.
 *
 * WGS84 geodetic -> geocentric Cartesian (Meeus ch. 11 style, exact ellipsoid), then rotated
 * about the pole by local mean sidereal time (UT1 ~ UTC).
 *
 * SIMPLIFICATION: the LST rotation is applied directly to the J2000 axes, i.e. precession
 * (~0.36 deg by 2026), nutation and polar motion are ignored. The offset is ~4.3e-5 AU,
 * so rotating its direction by ~0.4 deg shifts it by only ~3e-7 AU.
 */
export function observerGeocentric(site: Site, jdUtc: number): Vec3 {
  const phi = site.latDeg * DEG2RAD;
  const lon = site.lonEastDeg * DEG2RAD;
  const f = EARTH_FLATTENING;
  const e2 = f * (2 - f);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const N = EARTH_RADIUS_KM / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const h = site.elevM / 1000;
  const rho = (N + h) * cosPhi;
  const z = (N * (1 - e2) + h) * sinPhi;
  const theta = lst(jdUtc, lon);
  return rotateZ([rho / AU_KM, 0, z / AU_KM], theta);
}

/** Observer heliocentric state-position: Earth (EM barycenter) + geocentric offset. null = geocenter. */
export function observerHeliocentric(site: Site | null, jdTt: number, jdUtc: number): Vec3 {
  const earth: StateVector = earthHeliocentric(jdTt);
  return site ? add(earth.r, observerGeocentric(site, jdUtc)) : earth.r;
}
