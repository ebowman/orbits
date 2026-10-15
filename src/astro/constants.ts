/** Gaussian gravitational constant (rad/day). */
export const GAUSS_K = 0.01720209895;
/** Solar GM in AU^3/day^2 (Gaussian units). */
export const GM_SUN = GAUSS_K * GAUSS_K;
/** Astronomical unit in km. */
export const AU_KM = 149597870.7;
/** Speed of light in AU/day. */
export const C_AU_PER_DAY = 173.1446326846693;
/** Mean obliquity of the ecliptic at J2000 (IAU 1976), radians. */
export const OBLIQUITY_J2000_RAD = (84381.448 / 3600) * (Math.PI / 180);
/** Earth equatorial radius (WGS84), km. */
export const EARTH_RADIUS_KM = 6378.137;
/** Earth flattening (WGS84). */
export const EARTH_FLATTENING = 1 / 298.257223563;
/** Julian date of epoch J2000.0. */
export const J2000_JD = 2451545.0;
