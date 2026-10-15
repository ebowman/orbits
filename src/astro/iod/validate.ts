import { angularSeparation } from '../angles';
import type { Observation } from './types';

const MIN_SEPARATION_RAD = 1e-9;
const MIN_SPACING_DAYS = 0.5;
const MAX_ARC_DAYS = 120;

/**
 * Validate a set of observations for IOD. Throws a human-readable Error for
 * invalid input; returns non-fatal warnings otherwise.
 */
export function validateObservations(obs: readonly Observation[]): { warnings: string[] } {
  if (!Array.isArray(obs) || obs.length !== 3) {
    throw new Error(
      `Exactly 3 observations are required, but ${Array.isArray(obs) ? obs.length : 0} were given.`,
    );
  }
  obs.forEach((o, i) => {
    const n = i + 1;
    if (!Number.isFinite(o.jdUtc)) throw new Error(`Observation ${n} has an invalid date/time.`);
    if (!Number.isFinite(o.raRad)) throw new Error(`Observation ${n} has an invalid right ascension.`);
    if (!Number.isFinite(o.decRad)) throw new Error(`Observation ${n} has an invalid declination.`);
    if (Math.abs(o.decRad) > Math.PI / 2) {
      throw new Error(`Observation ${n} has a declination outside the range -90 to +90 degrees.`);
    }
  });
  for (let i = 0; i < 2; i++) {
    if (!(obs[i + 1].jdUtc > obs[i].jdUtc)) {
      throw new Error(
        `Observation times must be strictly increasing, but observation ${i + 2} is not later than observation ${i + 1}.`,
      );
    }
  }
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const sep = angularSeparation(obs[i].raRad, obs[i].decRad, obs[j].raRad, obs[j].decRad);
      if (sep < MIN_SEPARATION_RAD) {
        throw new Error(
          `Observations ${i + 1} and ${j + 1} point in the same direction; the object appears not to have moved.`,
        );
      }
    }
  }
  const warnings: string[] = [];
  for (let i = 0; i < 2; i++) {
    const dt = obs[i + 1].jdUtc - obs[i].jdUtc;
    if (dt < MIN_SPACING_DAYS) {
      warnings.push(
        `Observations ${i + 1} and ${i + 2} are only ${dt.toFixed(3)} days apart; results will be very sensitive to noise.`,
      );
    }
  }
  const arc = obs[2].jdUtc - obs[0].jdUtc;
  if (arc > MAX_ARC_DAYS) {
    warnings.push(
      `The total arc is ${arc.toFixed(1)} days; Gauss and Laplace methods assume a short arc and may be inaccurate.`,
    );
  }
  return { warnings };
}
