/**
 * Approximate heliocentric planet positions from the JPL "Keplerian Elements for
 * Approximate Positions of the Major Planets", Table 1 (valid 1800 AD - 2050 AD).
 * Source: https://ssd.jpl.nasa.gov/planets/approx_pos.html
 *
 * Elements are mean ecliptic & equinox of J2000. Each row: value at J2000 and rate per
 * Julian century. Table 1 needs no extra Jupiter-Neptune terms (those are Table 2b only).
 */
import { J2000_JD } from './constants';
import { DEG2RAD, normalizeRad } from './angles';
import type { OrbitalElements } from './elements';
import { elementsToState, type StateVector } from './state';

export type PlanetName =
  | 'Mercury' | 'Venus' | 'EMBary' | 'Mars' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune';

/** [a, e, I(deg), L(deg), long.peri(deg), long.node(deg)] value then rate per century. */
type Six = [number, number, number, number, number, number];
type Row = { v: Six; r: Six };

const TABLE1: Record<PlanetName, Row> = {
  Mercury: { v: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], r: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081] },
  Venus: { v: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], r: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418] },
  EMBary: { v: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0], r: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0] },
  Mars: { v: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], r: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343] },
  Jupiter: { v: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], r: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106] },
  Saturn: { v: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], r: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794] },
  Uranus: { v: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], r: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589] },
  Neptune: { v: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], r: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664] },
};

/** Valid range of Table 1: 1800-01-01 to 2050-12-31 (JD TT). */
export const PLANET_JD_MIN = 2378496.5;
export const PLANET_JD_MAX = 2469807.5;

/** Instantaneous osculating-style elements (ecliptic J2000) at jdTt, epoch = jdTt. */
export function planetElements(name: PlanetName, jdTt: number): OrbitalElements {
  const row = TABLE1[name];
  if (!row) throw new Error(`planetElements: unknown body "${name}"`);
  if (!(jdTt >= PLANET_JD_MIN && jdTt <= PLANET_JD_MAX)) {
    throw new Error(`planetElements: JD ${jdTt} outside valid range 1800-2050 of Standish Table 1`);
  }
  const T = (jdTt - J2000_JD) / 36525;
  const [a, e, I, L, wbar, node] = row.v.map((x, k) => x + (row.r[k] as number) * T) as Six;
  return {
    a,
    e,
    i: I * DEG2RAD,
    Omega: normalizeRad(node * DEG2RAD),
    omega: normalizeRad((wbar - node) * DEG2RAD),
    M0: normalizeRad((L - wbar) * DEG2RAD),
    epochJd: jdTt,
    frame: 'eclipticJ2000',
  };
}

/** Heliocentric position/velocity, J2000 equatorial, AU and AU/day. Throws outside 1800-2050. */
export function planetHeliocentric(name: PlanetName, jdTt: number): StateVector {
  return elementsToState(planetElements(name, jdTt), jdTt);
}

/**
 * Earth heliocentric state taken as the Earth-Moon barycenter from the same table.
 * The Earth-EMB offset (~4670 km, ~3e-5 AU) is accepted as error.
 */
export function earthHeliocentric(jdTt: number): StateVector {
  return planetHeliocentric('EMBary', jdTt);
}
