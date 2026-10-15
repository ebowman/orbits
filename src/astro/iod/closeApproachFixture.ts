// Deterministic noise-free close-approach triplets shared by the gauss and laplace regression tests.
import type { OrbitalElements } from '../elements';
import { predict } from '../ephemeris';
import { earthHeliocentric } from '../planets';
import { elementsToState, stateToElements } from '../state';
import { jdUtcToTt } from '../time';
import { add, cross, scale, unit } from '../vec';
import type { IODInput } from './types';

const KMS_PER_AU_DAY = 1731.456837;
const TCA_UTC = 2461000.5;

export type CloseApproachCase = { rho2: number; kms: number; dir: 'radial-out' | 'perp' | 'mixed'; spacing: number };

export const CLOSE_APPROACH_CASES: CloseApproachCase[] = [
  { rho2: 0.02, kms: 5, dir: 'perp', spacing: 2 },
  { rho2: 0.04, kms: 7, dir: 'mixed', spacing: 4 },
  { rho2: 0.02, kms: 10, dir: 'radial-out', spacing: 3 },
];

/** Object `rho2` AU from the geocentre at mid-epoch moving `kms` km/s relative to Earth; geocentric observations. */
export function closeApproach(c: CloseApproachCase): { obs: IODInput; el: OrbitalElements; jdTt2: number } {
  const tt = jdUtcToTt(TCA_UTC);
  const E = earthHeliocentric(tt);
  const rhat = unit(E.r);
  const vhat = unit(E.v);
  const nhat = unit(cross(rhat, vhat));
  const off = scale(unit(add(scale(rhat, 0.6), scale(nhat, 0.8))), c.rho2);
  const dv =
    c.dir === 'radial-out'
      ? unit(add(nhat, scale(vhat, 0.3)))
      : c.dir === 'perp'
        ? unit(add(vhat, scale(rhat, 0.5)))
        : unit(add(add(vhat, nhat), scale(rhat, -0.4)));
  const r = add(E.r, off);
  const v = add(E.v, scale(dv, c.kms / KMS_PER_AU_DAY));
  const el: OrbitalElements = { ...stateToElements(r, v, tt).elements, epochJd: tt };
  const obs = [-c.spacing, 0, c.spacing].map((d) => {
    const p = predict(el, TCA_UTC + d, null);
    return { jdUtc: TCA_UTC + d, raRad: p.raRad, decRad: p.decRad, site: null };
  }) as IODInput;
  return { obs, el, jdTt2: tt };
}

export function trueElementsAt(el: OrbitalElements, jdTt: number): OrbitalElements {
  const t = elementsToState(el, jdTt);
  return stateToElements(t.r, t.v, jdTt).elements;
}
