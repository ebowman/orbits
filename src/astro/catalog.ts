import raw from '@data/catalog.json';
import { DEG2RAD } from './angles';
import type { EphemerisBody } from './ephemeris';
import type { PlanetName } from './planets';

export type CatalogEntry = {
  id: string;
  name: string;
  kind: 'asteroid' | 'planet';
  /** Orbital elements (asteroid) or {planet} reference (planet). */
  body: EphemerisBody;
  /** Absolute magnitude / slope; undefined for planets. */
  H?: number;
  G?: number;
};

type RawEntry = {
  id: string;
  name: string;
  kind: 'asteroid' | 'planet';
  epochJdTt?: number;
  a?: number;
  e?: number;
  iDeg?: number;
  OmegaDeg?: number;
  omegaDeg?: number;
  MDeg?: number;
  H?: number;
  G?: number;
};

/** Convert the bundled catalog (degrees) into entries with radian OrbitalElements. */
export function loadCatalog(): CatalogEntry[] {
  return (raw as RawEntry[]).map((r): CatalogEntry => {
    if (r.kind === 'planet') {
      return { id: r.id, name: r.name, kind: 'planet', body: { planet: r.name as PlanetName } };
    }
    const need = [r.epochJdTt, r.a, r.e, r.iDeg, r.OmegaDeg, r.omegaDeg, r.MDeg];
    if (need.some((x) => typeof x !== 'number')) throw new Error(`catalog: incomplete elements for ${r.name}`);
    const [epochJd, a, e, i, Om, om, M] = need as number[];
    return {
      id: r.id,
      name: r.name,
      kind: 'asteroid',
      body: {
        a: a as number,
        e: e as number,
        i: (i as number) * DEG2RAD,
        Omega: (Om as number) * DEG2RAD,
        omega: (om as number) * DEG2RAD,
        M0: (M as number) * DEG2RAD,
        epochJd: epochJd as number,
        frame: 'eclipticJ2000',
      },
      H: r.H,
      G: r.G,
    };
  });
}
