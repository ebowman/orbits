/** Calendar components in UTC. `day` may be fractional. */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}

/**
 * Julian date from a Gregorian (on/after 1582-10-15) or Julian calendar date (Meeus ch. 7).
 * Time-scale agnostic; the caller decides whether it is UTC.
 */
export function calendarToJd(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  if (month < 1 || month > 12) throw new Error(`calendarToJd: month out of range: ${month}`);
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const gregorian =
    year > 1582 || (year === 1582 && (month > 10 || (month === 10 && day >= 15)));
  let b = 0;
  if (gregorian) {
    const a = Math.floor(y / 100);
    b = 2 - a + Math.floor(a / 4);
  }
  const dayFrac = day + (hour + (minute + second / 60) / 60) / 24;
  return (
    Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + dayFrac + b - 1524.5
  );
}

/** JD(UTC) from a JS Date or CalendarDate. */
export function utcToJd(d: Date | CalendarDate): number {
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) throw new Error('utcToJd: invalid Date');
    return d.getTime() / 86400000 + 2440587.5;
  }
  return calendarToJd(d.year, d.month, d.day, d.hour ?? 0, d.minute ?? 0, d.second ?? 0);
}

/** Inverse of calendarToJd. `day` is fractional; use jdToCalendar for split fields. */
export function jdToCalendar(jd: number): Required<CalendarDate> {
  const j = jd + 0.5;
  const z = Math.floor(j);
  const f = j - z;
  let a = z;
  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + alpha - Math.floor(alpha / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const dayInt = b - d - Math.floor(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  let secs = Math.round(f * 86400 * 1e6) / 1e6;
  if (secs >= 86400) {
    // Rounding carried into the next day; recompute via a nudge.
    return jdToCalendar(jd + 1e-9);
  }
  const hour = Math.floor(secs / 3600);
  secs -= hour * 3600;
  const minute = Math.floor(secs / 60);
  secs -= minute * 60;
  return { year, month, day: dayInt, hour, minute, second: secs };
}

/** [JD(UTC) at which the offset took effect (0h), TAI-UTC in seconds]. */
const LEAP_SECONDS: ReadonlyArray<readonly [number, number]> = (
  [
    [1972, 1, 10],
    [1972, 7, 11],
    [1973, 1, 12],
    [1974, 1, 13],
    [1975, 1, 14],
    [1976, 1, 15],
    [1977, 1, 16],
    [1978, 1, 17],
    [1979, 1, 18],
    [1980, 1, 19],
    [1981, 7, 20],
    [1982, 7, 21],
    [1983, 7, 22],
    [1985, 7, 23],
    [1988, 1, 24],
    [1990, 1, 25],
    [1991, 1, 26],
    [1992, 7, 27],
    [1993, 7, 28],
    [1994, 7, 29],
    [1996, 1, 30],
    [1997, 7, 31],
    [1999, 1, 32],
    [2006, 1, 33],
    [2009, 1, 34],
    [2012, 7, 35],
    [2015, 7, 36],
    [2017, 1, 37],
  ] as const
).map(([y, m, off]) => [calendarToJd(y, m, 1), off] as const);

export const TT_MINUS_TAI_S = 32.184;

/** TAI-UTC (seconds) at the given JD(UTC). Throws for dates before 1972-01-01. */
export function taiMinusUtc(jdUtc: number): number {
  const first = LEAP_SECONDS[0]!;
  if (jdUtc < first[0]) {
    throw new Error('taiMinusUtc: dates before 1972-01-01 are not supported (no leap-second table)');
  }
  let off = first[1];
  for (const [jd, o] of LEAP_SECONDS) {
    if (jdUtc >= jd) off = o;
    else break;
  }
  return off;
}

/** Convert JD(UTC) to JD(TT). Offset after 2017-01-01 is held at 37 s. */
export function jdUtcToTt(jdUtc: number): number {
  return jdUtc + (taiMinusUtc(jdUtc) + TT_MINUS_TAI_S) / 86400;
}
