import { normalizeRad } from './angles';

/**
 * Equatorial -> horizontal. All angles in radians; `lstRad` is local sidereal time.
 * Azimuth is measured from North through East, in [0, 2π).
 */
export function equatorialToHorizontal(
  ra: number,
  dec: number,
  lstRad: number,
  lat: number,
): { alt: number; az: number } {
  const h = lstRad - ra;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  // Azimuth from North through East.
  const y = -Math.cos(dec) * Math.sin(h);
  const x = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.cos(h) * Math.sin(lat);
  return { alt, az: normalizeRad(Math.atan2(y, x)) };
}
