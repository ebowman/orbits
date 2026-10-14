import {
  angularSeparation,
  elementsToState,
  gauss,
  jdUtcToTt,
  laplace,
  periodDays,
  perihelionQ,
  predict,
  stateToElements,
  type IODInput,
  type IODResult,
  type OrbitalElements,
  type Observation,
} from '@astro';

const DEG = 180 / Math.PI;
const ARCSEC = 206264.80624709636;

export type MethodId = 'gauss' | 'laplaceClassical' | 'laplaceRefined';
export const METHOD_IDS: MethodId[] = ['gauss', 'laplaceClassical', 'laplaceRefined'];
export const METHOD_LABEL: Record<MethodId, string> = {
  gauss: 'Gauss',
  laplaceClassical: 'Laplace (classical)',
  laplaceRefined: 'Laplace (refined)',
};

export type MethodOutcome = { ok: true; result: IODResult } | { ok: false; error: string };
export type Outcomes = Record<MethodId, MethodOutcome>;

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Wrap an angle difference in degrees into [-180, 180]. */
export function wrapDeg(d: number): number {
  let x = d % 360;
  if (x > 180) x -= 360;
  else if (x < -180) x += 360;
  return x;
}

/** Wrap an angle difference in radians into [-pi, pi]. */
export function wrapRad(d: number): number {
  let x = d % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  else if (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

/** Bring elements to another epoch (TT JD) by two-body propagation. No perturbations. */
export function propagateElements(el: OrbitalElements, jdTt: number): OrbitalElements {
  if (el.epochJd === jdTt) return el;
  const s = elementsToState(el, jdTt);
  return stateToElements(s.r, s.v, jdTt).elements;
}

/** Common epoch: Gauss jdTt2, else refined Laplace jdTt2, else middle observation TT. */
export function commonEpoch(obs: IODInput, o: Outcomes): number {
  if (o.gauss.ok) return o.gauss.result.jdTt2;
  if (o.laplaceRefined.ok) return o.laplaceRefined.result.jdTt2;
  return jdUtcToTt(obs[1].jdUtc);
}

export const ELEMENT_KEYS = ['a', 'e', 'i', 'Omega', 'omega', 'M', 'q', 'period'] as const;
export type ElementKey = (typeof ELEMENT_KEYS)[number];
export const ELEMENT_LABEL: Record<ElementKey, string> = {
  a: 'a (AU)',
  e: 'e',
  i: 'i (deg)',
  Omega: 'Ω (deg)',
  omega: 'ω (deg)',
  M: 'M (deg)',
  q: 'q (AU)',
  period: 'period (years)',
};
const ANGLE_KEYS: ReadonlySet<ElementKey> = new Set(['i', 'Omega', 'omega', 'M']);
export const isAngleKey = (k: ElementKey): boolean => ANGLE_KEYS.has(k);

/** Display values; angles in degrees normalised to [0, 360), period in years (Infinity if unbound). */
export function elementValues(el: OrbitalElements): Record<ElementKey, number> {
  const n360 = (r: number) => {
    const d = (r * DEG) % 360;
    return d < 0 ? d + 360 : d;
  };
  return {
    a: el.a,
    e: el.e,
    i: n360(el.i),
    Omega: n360(el.Omega),
    omega: n360(el.omega),
    M: n360(el.M0),
    q: perihelionQ(el),
    period: periodDays(el) / 365.25,
  };
}

export type ElementError = { abs: number; pct: number };

/** Error of a solution value versus the catalog value; angles wrapped to +-180 deg. pct is relative to |catalog|. */
export function elementError(key: ElementKey, sol: number, cat: number): ElementError {
  const abs = isAngleKey(key) ? wrapDeg(sol - cat) : sol - cat;
  let pct: number;
  if (Number.isNaN(abs)) pct = NaN;
  else if (abs === 0) pct = 0;
  else if (cat === 0) pct = Infinity;
  else pct = (Math.abs(abs) / Math.abs(cat)) * 100;
  return { abs, pct };
}

export type ErrorSeverity = 'good' | 'warn' | 'bad';
/** green under 1 %, amber under 10 %, red otherwise (including NaN). */
export function severity(pct: number): ErrorSeverity {
  if (pct < 1) return 'good';
  if (pct < 10) return 'warn';
  return 'bad';
}

export type Residual = { raCosDecArcsec: number; decArcsec: number };
/** O-C in RA*cos(dec) and Dec (arcsec) for each observation. */
export function residuals(el: OrbitalElements, obs: IODInput): Residual[] {
  return obs.map((o) => {
    const p = predict(el, o.jdUtc, o.site);
    return {
      raCosDecArcsec: wrapRad(o.raRad - p.raRad) * Math.cos(o.decRad) * ARCSEC,
      decArcsec: (o.decRad - p.decRad) * ARCSEC,
    };
  });
}

export const FORWARD_DAYS = [7, 30, 90] as const;
export type ForwardPoint = { raRad: number; decRad: number; sepArcmin: number | null };

/** Predicted position at jd for a body, plus separation from catalog prediction (arcmin) if given. */
export function forwardPoint(
  el: OrbitalElements,
  jdUtc: number,
  site: Observation['site'],
  catalog: OrbitalElements | null,
): ForwardPoint {
  const p = predict(el, jdUtc, site);
  let sepArcmin: number | null = null;
  if (catalog) {
    const c = predict(catalog, jdUtc, site);
    sepArcmin = angularSeparation(p.raRad, p.decRad, c.raRad, c.decRad) * DEG * 60;
  }
  return { raRad: p.raRad, decRad: p.decRad, sepArcmin };
}

/** Forward predictions at +7, +30, +90 d after the last observation, from the last observation's site. */
export function forwardPredictions(el: OrbitalElements, obs: IODInput, catalog: OrbitalElements | null): ForwardPoint[] {
  const last = obs[2];
  return FORWARD_DAYS.map((d) => forwardPoint(el, last.jdUtc + d, last.site, catalog));
}

/** Per-root status parsed from the 'roots' trace step of an IOD result. */
export type RootInfo = { index: number; r2: number; accepted: boolean; reason: string | null };
export function rootInfos(res: IODResult): RootInfo[] {
  const step = res.trace.find((t) => t.id === 'roots');
  const roots = res.rootsConsidered;
  return roots.map((r2, index) => {
    const s = step?.values[`status-${index}`];
    const accepted = s === 'accepted';
    return { index, r2, accepted, reason: accepted ? null : typeof s === 'string' ? s.replace(/^rejected:\s*/, '') : 'unknown' };
  });
}
export const chosenRootIndex = (res: IODResult): number => {
  const v = res.trace.find((t) => t.id === 'roots')?.values.chosenIndex;
  return typeof v === 'number' ? v : res.rootsConsidered.indexOf(res.chosenRoot);
};

/** Index of the root nearest (in AU) to a target heliocentric distance. */
export function nearestRootIndex(roots: number[], r2: number): number {
  let best = 0;
  roots.forEach((r, k) => {
    if (Math.abs(r - r2) < Math.abs((roots[best] as number) - r2)) best = k;
  });
  return best;
}

function runOne(fn: (idx?: number) => IODResult, wantR2: number | null): MethodOutcome {
  try {
    let res = fn();
    if (wantR2 !== null && res.rootsConsidered.length > 1) {
      const k = nearestRootIndex(res.rootsConsidered, wantR2);
      if (k !== chosenRootIndex(res)) res = fn(k);
    }
    return { ok: true, result: res };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

/**
 * Run Gauss, classical Laplace and refined Laplace. Each is isolated: a throw becomes that method's error.
 * wantR2 (heliocentric distance in AU) selects the nearest root in each method's own root list.
 */
export function runSolvers(obs: IODInput, wantR2: number | null = null): Outcomes {
  return {
    gauss: runOne((k) => gauss(obs, k === undefined ? {} : { rootIndex: k }), wantR2),
    laplaceClassical: runOne((k) => laplace(obs, k === undefined ? { iterate: false } : { iterate: false, rootIndex: k }), wantR2),
    laplaceRefined: runOne((k) => laplace(obs, k === undefined ? { iterate: true } : { iterate: true, rootIndex: k }), wantR2),
  };
}

/** Elements for a method (laplace with iterate:false already returns the classical elements), or null on failure. */
export function methodElements(o: MethodOutcome): OrbitalElements | null {
  return o.ok ? o.result.elements : null;
}

export type Candidate = { rootIndex: number; r2: number; elements: OrbitalElements; selected: boolean };

/** The method whose roots define the candidate list: Gauss, else refined Laplace. */
export function primaryMethod(o: Outcomes): MethodId | null {
  if (o.gauss.ok) return 'gauss';
  if (o.laplaceRefined.ok) return 'laplaceRefined';
  return null;
}

/** Candidate solutions (one per surviving root), elements propagated to jdTt. */
export function candidates(obs: IODInput, o: Outcomes, jdTt: number): { method: MethodId; all: RootInfo[]; survivors: Candidate[] } | null {
  const m = primaryMethod(o);
  const out = m ? o[m] : null;
  if (!m || !out || !out.ok) return null;
  const all = rootInfos(out.result);
  const chosen = chosenRootIndex(out.result);
  const survivors: Candidate[] = [];
  for (const r of all) {
    if (!r.accepted) continue;
    try {
      const res =
        r.index === chosen
          ? out.result
          : m === 'gauss'
            ? gauss(obs, { rootIndex: r.index })
            : laplace(obs, { iterate: true, rootIndex: r.index });
      survivors.push({ rootIndex: r.index, r2: r.r2, elements: propagateElements(res.elements, jdTt), selected: r.index === chosen });
    } catch {
      // A surviving root that cannot be re-run is simply not listed.
    }
  }
  return { method: m, all, survivors };
}
