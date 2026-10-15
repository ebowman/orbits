/** Shared data-source and trace helpers for the Learn walkthrough pages. */
import { useState } from 'react';
import {
  bestElongationStart,
  loadCatalog,
  predict,
  stateToElements,
  type IODInput,
  type Observation,
  type OrbitalElements,
  type TraceStep,
  type Vec3,
} from '@astro';
import { useStore } from '../store';

export function findBody(id: string | undefined): { name: string; el: OrbitalElements } | null {
  if (!id) return null;
  const e = loadCatalog().find((c) => c.id === id);
  if (!e || !('a' in e.body)) return null;
  return { name: e.name, el: e.body as OrbitalElements };
}

let cachedExample: IODInput | null = null;
/** Noise-free Ceres observations 10 d apart, starting near maximum elongation (not at the epoch). */
export function ceresExample(): IODInput {
  if (cachedExample) return cachedExample;
  const ceres = findBody('1');
  if (!ceres) throw new Error('Catalog is missing Ceres');
  const start = bestElongationStart(ceres.el);
  cachedExample = [0, 10, 20].map((d): Observation => {
    const p = predict(ceres.el, start + d, null);
    return { jdUtc: start + d, raRad: p.raRad, decRad: p.decRad, site: null, label: `Ceres day ${d}` };
  }) as IODInput;
  return cachedExample;
}

export type Source = 'store' | 'example';

/** Picks the active store set if it has exactly 3 observations, else the Ceres example. */
export function useIodSource() {
  const sets = useStore((s) => s.observationSets);
  const activeId = useStore((s) => s.activeSetId);
  const active = sets.find((s) => s.id === activeId);
  const storeObs = active && active.observations.length === 3 ? (active.observations as IODInput) : null;
  const [choice, setChoice] = useState<Source>('store');
  const source: Source = storeObs && choice === 'store' ? 'store' : 'example';
  return { active, storeObs, source, setChoice };
}

export const isVec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number');
export const vec = (trace: TraceStep[], id: string, key: string): Vec3 | null => {
  const v = trace.find((s) => s.id === id)?.values[key];
  return isVec(v) ? v : null;
};
export const nums = (trace: TraceStep[], id: string, key: string): number[] | null => {
  const v = trace.find((s) => s.id === id)?.values[key];
  return Array.isArray(v) && v.every((x) => typeof x === 'number') ? (v as number[]) : null;
};
export const num = (trace: TraceStep[], id: string, key: string): number | null => {
  const v = trace.find((s) => s.id === id)?.values[key];
  return typeof v === 'number' ? v : null;
};

export function orbitFromState(r: Vec3 | null, v: Vec3 | null, jdTt: number | null): OrbitalElements | null {
  if (!r || !v || jdTt === null) return null;
  try {
    const el = stateToElements(r, v, jdTt).elements;
    return el.e < 1 && el.a > 0 && Number.isFinite(el.a) ? el : null;
  } catch {
    return null;
  }
}
