/**
 * Pure visibility / planning computations (no UI). All times are JD(UTC).
 * Simplifications (deliberate): the Sun direction ignores parallax and refraction, and so does
 * the body altitude; RA/Dec stay J2000 and are used with LST of date, exactly as predict() callers do.
 */
import { DEG2RAD, RAD2DEG } from './angles';
import type { CatalogEntry } from './catalog';
import { predict } from './ephemeris';
import { unitToRadec } from './frames';
import { equatorialToHorizontal } from './horizon';
import { hgMagnitude } from './magnitude';
import { earthHeliocentric } from './planets';
import type { Site } from './observer';
import { lst } from './sidereal';
import { calendarToJd, jdToCalendar, jdUtcToTt } from './time';
import { angularSeparation } from './angles';

export type DateUtc = { year: number; month: number; day: number };
export type DarkWindow = { startJd: number; endJd: number };

export const SAMPLE_STEP_DAYS = 15 / 1440;
export const ASTRO_TWILIGHT_DEG = -18;

/** Geocentric Sun RA/Dec (J2000) = direction of -Earth heliocentric position. No parallax. */
export function sunRaDec(jdUtc: number): { ra: number; dec: number } {
  const r = earthHeliocentric(jdUtcToTt(jdUtc)).r;
  return unitToRadec([-r[0], -r[1], -r[2]]);
}

/** Sun altitude (rad) at the site; no refraction, no parallax. */
export function sunAltitude(site: Site, jdUtc: number): number {
  const { ra, dec } = sunRaDec(jdUtc);
  return equatorialToHorizontal(ra, dec, lst(jdUtc, site.lonEastDeg * DEG2RAD), site.latDeg * DEG2RAD).alt;
}

const isDark = (site: Site, jd: number) => sunAltitude(site, jd) < ASTRO_TWILIGHT_DEG * DEG2RAD;

/** Bisect the dark/not-dark boundary between jdDark and jdLight. */
function refine(site: Site, jdDark: number, jdLight: number): number {
  let a = jdDark;
  let b = jdLight;
  for (let i = 0; i < 12; i++) {
    const m = (a + b) / 2;
    if (isDark(site, m)) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/**
 * Astronomical-dark window (Sun alt < -18 deg) of the night starting on the evening of the UTC
 * calendar date. Local midnight ~ 24:00 - lonEast/15 h UTC on that date; searches +-12 h in 15 min steps.
 * Polar day / no darkness -> null. Sun never rises above -18 deg -> full 24 h window.
 */
export function darkWindow(site: Site, date: DateUtc): DarkWindow | null {
  // Normalise longitude to (-180, 180] so 204.5 and -155.5 select the same local night.
  let lon = ((site.lonEastDeg % 360) + 360) % 360;
  if (lon > 180) lon -= 360;
  const mid = calendarToJd(date.year, date.month, date.day, 0, 0, 0) + (24 - lon / 15) / 24;
  const n = 48; // 48 steps of 15 min each side
  const jds: number[] = [];
  const dark: boolean[] = [];
  for (let k = -n; k <= n; k++) {
    const jd = mid + k * SAMPLE_STEP_DAYS;
    jds.push(jd);
    dark.push(isDark(site, jd));
  }
  if (dark.every(Boolean)) return { startJd: jds[0]!, endJd: jds[jds.length - 1]! };
  if (!dark.some(Boolean)) return null;
  // Contiguous dark run nearest to local midnight (index n).
  let best: [number, number] | null = null;
  let bestDist = Infinity;
  let i = 0;
  while (i < dark.length) {
    if (!dark[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < dark.length && dark[j + 1]) j++;
    const dist = n >= i && n <= j ? 0 : Math.min(Math.abs(i - n), Math.abs(j - n));
    if (dist < bestDist) {
      bestDist = dist;
      best = [i, j];
    }
    i = j + 1;
  }
  const [s, e] = best!;
  const startJd = s > 0 ? refine(site, jds[s]!, jds[s - 1]!) : jds[s]!;
  const endJd = e < dark.length - 1 ? refine(site, jds[e]!, jds[e + 1]!) : jds[e]!;
  return { startJd, endJd };
}

/** Altitude/azimuth (rad) of the body at the instant, via predict() and the site's LST. */
export function bodyAltAz(entry: CatalogEntry, site: Site, jdUtc: number) {
  const p = predict(entry.body, jdUtc, site);
  const hz = equatorialToHorizontal(p.raRad, p.decRad, lst(jdUtc, site.lonEastDeg * DEG2RAD), site.latDeg * DEG2RAD);
  return { pred: p, ...hz };
}

export type BodyVisibility = {
  id: string;
  name: string;
  maxAltRad: number;
  maxAltDeg: number;
  jdMaxAlt: number;
  raRad: number;
  decRad: number;
  /** Apparent V (H-G asteroids); null for planets. */
  v: number | null;
  /** True when V is unavailable because the body is a planet ('approx n/a'). */
  vApproxNA: boolean;
  elongationRad: number;
};

/** Sample the window every 15 min and report the maximum-altitude moment. Null window -> null. */
export function bodyVisibility(entry: CatalogEntry, site: Site, window: DarkWindow | null): BodyVisibility | null {
  if (!window) return null;
  let best: { alt: number; jd: number; ra: number; dec: number; pred: ReturnType<typeof predict> } | null = null;
  const steps = Math.max(0, Math.floor((window.endJd - window.startJd) / SAMPLE_STEP_DAYS + 1e-9));
  for (let k = 0; k <= steps; k++) {
    const jd = Math.min(window.endJd, window.startJd + k * SAMPLE_STEP_DAYS);
    const { pred, alt } = bodyAltAz(entry, site, jd);
    if (!best || alt > best.alt) best = { alt, jd, ra: pred.raRad, dec: pred.decRad, pred };
  }
  if (!best) return null;
  const sun = sunRaDec(best.jd);
  const v =
    entry.kind === 'asteroid' && entry.H !== undefined && entry.G !== undefined
      ? hgMagnitude(entry.H, entry.G, best.pred.rHelioAu, best.pred.deltaAu, best.pred.phaseAngleRad)
      : null;
  return {
    id: entry.id,
    name: entry.name,
    maxAltRad: best.alt,
    maxAltDeg: best.alt * RAD2DEG,
    jdMaxAlt: best.jd,
    raRad: best.ra,
    decRad: best.dec,
    v,
    vApproxNA: v === null,
    elongationRad: angularSeparation(best.ra, best.dec, sun.ra, sun.dec),
  };
}

export type PlanNight = {
  date: DateUtc;
  window: DarkWindow | null;
  /** null when the body is not observable (no dark window, or never above the horizon). */
  best: { jd: number; raRad: number; decRad: number; altDeg: number } | null;
};

export function addDays(date: DateUtc, days: number): DateUtc {
  const c = jdToCalendar(calendarToJd(date.year, date.month, date.day, 12, 0, 0) + days);
  return { year: c.year, month: c.month, day: c.day };
}

/** Three nights N, N+s, N+2s with the best (max-altitude) time in each dark window. */
export function suggestPlan(entry: CatalogEntry, site: Site, startDateUtc: DateUtc, spacingDays = 7): PlanNight[] {
  return [0, 1, 2].map((k) => {
    const date = addDays(startDateUtc, k * spacingDays);
    const window = darkWindow(site, date);
    const vis = bodyVisibility(entry, site, window);
    const best =
      vis && vis.maxAltRad > 0
        ? { jd: vis.jdMaxAlt, raRad: vis.raRad, decRad: vis.decRad, altDeg: vis.maxAltDeg }
        : null;
    return { date, window, best };
  });
}

