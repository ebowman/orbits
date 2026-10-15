import type { Vec3 } from '../vec';
import type { Site } from '../observer';
import type { OrbitalElements } from '../elements';

/** One astrometric observation (RA/Dec, J2000 equatorial, radians). */
export type Observation = {
  jdUtc: number;
  raRad: number;
  decRad: number;
  /** Observing site; null means geocentric. */
  site: Site | null;
  label?: string;
};

/** Exactly three observations, strictly increasing in time. */
export type IODInput = [Observation, Observation, Observation];

/**
 * One step of the computation trace, replayed by the walkthrough visualizations.
 *
 * `explanation` is 1-3 sentences of plain English and may contain simple TeX
 * between $...$.
 *
 * Step ids emitted by Gauss (orbits-q9e.8):
 *   'los-vectors', 'observer-positions', 'time-intervals', 'd-scalars',
 *   'polynomial', 'roots', 'slant-ranges', 'initial-orbit',
 *   'iteration-<n>' (stored iterations capped at 20), 'final-state', 'elements'.
 *
 * Step ids emitted by Laplace (orbits-q9e.9):
 *   'los-vectors', 'interpolation', 'derivatives', 'observer-state',
 *   'determinants', 'polynomial', 'roots', 'rho-rhodot', 'classical-result',
 *   'iteration-<n>' (capped at 20), 'final-state', 'elements'.
 */
export type TraceStep = {
  id: string;
  title: string;
  explanation: string;
  values: Record<string, number | number[] | Vec3 | string>;
};

export type IODResult = {
  method: 'gauss' | 'laplace';
  elements: OrbitalElements;
  r2: Vec3;
  v2: Vec3;
  jdTt2: number;
  rootsConsidered: number[];
  chosenRoot: number;
  iterations: number;
  converged: boolean;
  warnings: string[];
  trace: TraceStep[];
};
