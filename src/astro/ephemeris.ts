/**
 * Astrometric topocentric ephemeris predictor.
 * Light-time corrected (body evaluated at t - tau), no aberration / deflection, matching the
 * JPL Horizons QUANTITIES=1 "astrometric" convention. Output is J2000 equatorial RA/Dec.
 */
import { C_AU_PER_DAY } from './constants';
import type { OrbitalElements } from './elements';
import { unitToRadec } from './frames';
import { planetHeliocentric, type PlanetName } from './planets';
import { elementsToState } from './state';
import { jdUtcToTt } from './time';
import { observerHeliocentric, type Site } from './observer';
import { dot, norm, sub, type Vec3 } from './vec';

export type PlanetBody = { planet: PlanetName };
export type EphemerisBody = OrbitalElements | PlanetBody;

export type Prediction = {
  raRad: number;
  decRad: number;
  /** Observer-to-body distance (AU) at light-corrected position. */
  deltaAu: number;
  /** Sun-to-body distance (AU) at light-corrected position. */
  rHelioAu: number;
  /** Sun-body-observer angle (rad), 0..pi. */
  phaseAngleRad: number;
  lightTimeDays: number;
  /** Heliocentric observer position at t (J2000 equatorial, AU). */
  rObserver: Vec3;
  /** Heliocentric body position at t - tau (J2000 equatorial, AU). */
  rBody: Vec3;
};

const isPlanet = (b: EphemerisBody): b is PlanetBody => 'planet' in b;

function bodyPosition(body: EphemerisBody, jdTt: number): Vec3 {
  return isPlanet(body) ? planetHeliocentric(body.planet, jdTt).r : elementsToState(body, jdTt).r;
}

/** Predict astrometric RA/Dec of a body seen from `site` (null = geocenter) at UTC Julian date jdUtc. */
export function predict(body: EphemerisBody, jdUtc: number, site: Site | null): Prediction {
  const jdTt = jdUtcToTt(jdUtc);
  const rObserver = observerHeliocentric(site, jdTt, jdUtc);
  let rBody = bodyPosition(body, jdTt);
  let tau = norm(sub(rBody, rObserver)) / C_AU_PER_DAY;
  for (let i = 0; i < 10; i++) {
    rBody = bodyPosition(body, jdTt - tau);
    const next = norm(sub(rBody, rObserver)) / C_AU_PER_DAY;
    const done = Math.abs(next - tau) < 1e-10;
    tau = next;
    if (done) break;
  }
  const rel = sub(rBody, rObserver);
  const deltaAu = norm(rel);
  const rHelioAu = norm(rBody);
  // Phase angle at the body between directions to the Sun (-rBody) and to the observer (-rel).
  const cosA = dot(rBody, rel) / (rHelioAu * deltaAu);
  const phaseAngleRad = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const { ra, dec } = unitToRadec(rel);
  return { raRad: ra, decRad: dec, deltaAu, rHelioAu, phaseAngleRad, lightTimeDays: tau, rObserver, rBody };
}
