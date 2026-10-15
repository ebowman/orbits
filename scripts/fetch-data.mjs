#!/usr/bin/env node
// Dev-time data fetcher (Node 18+, built-in fetch, no deps). Run: npm run fetch-data
// The app never fetches at runtime; outputs are committed.
//
// SBDB field mapping (sbdb.api?sstr=N&phys-par=1&full-prec=1):
//   orbit.elements[name=e|a|i|om|w|ma] -> e, a(au), iDeg, OmegaDeg (om), omegaDeg (w), MDeg (ma)
//   orbit.epoch (JD, TDB) -> epochJdTt. TDB and TT differ by < 2 ms, so TDB ~= TT here.
//   phys_par[name=H|G] -> H, G (G defaults to 0.15 when absent)
//   NOTE: without full-prec=1 SBDB rounds values to a few digits; always request full precision.
// Horizons: result text between $$SOE/$$EOE, CSV. Site coords parsed from the
//   "Center geodetic : E-lon(deg),Lat(deg),Alt(km)" header line.
import { writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SBDB = 'https://ssd-api.jpl.nasa.gov/sbdb.api';
const HORIZONS = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const BODIES = [
  [1, 'Ceres'], [2, 'Pallas'], [3, 'Juno'], [4, 'Vesta'],
  [6, 'Hebe'], [7, 'Iris'], [10, 'Hygiea'], [433, 'Eros'],
];
const FIXTURE_BODIES = [1, 4, 433];
const SITE = '568';
const HALF_WINDOW_DAYS = 20; // 41 daily rows centred on the SBDB epoch

// Opposition windows: day 0 of each 41-row daily window (JD UTC). These are the dates of
// maximum solar elongation within +-400 d of the SBDB epoch, found with predict() in the
// Gauss tests (bestStart in src/astro/iod/gauss.test.ts). Triplets at days 0/10/20 and 0/5/10
// therefore sit at/near opposition. Hard-coded so the script needs no TS toolchain.
const OPPOSITION_START = { 1: 2461410.5, 4: 2461325.5, 433: 2460975.5 };
const TT_MINUS_UTC_DAYS = 69.184 / 86400; // TAI-UTC 37 s + 32.184 s (valid 2017-2035 absent new leap seconds)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      console.error(`attempt ${attempt}/3 failed for ${url}: ${err.message}`);
      if (attempt < 3) await sleep(1000 * 2 ** attempt);
    }
  }
  throw new Error(`giving up on ${url}: ${lastErr.message}`);
}

async function writeJsonAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await rename(tmp, path);
}

function num(x, label) {
  const v = Number(x);
  if (x === undefined || x === null || x === '' || !Number.isFinite(v)) {
    throw new Error(`non-numeric ${label}: ${x}`);
  }
  return v;
}

async function fetchBody(id, name, fetchedAt) {
  const url = `${SBDB}?sstr=${id}&phys-par=1&full-prec=1`;
  const d = await getJson(url);
  if (!d.orbit || !d.orbit.elements) throw new Error(`SBDB: no orbit for ${id}`);
  const el = Object.fromEntries(d.orbit.elements.map((e) => [e.name, e.value]));
  const phys = Object.fromEntries((d.phys_par ?? []).map((p) => [p.name, p.value]));
  return {
    id: String(id),
    name,
    kind: 'asteroid',
    epochJdTt: num(d.orbit.epoch, 'epoch'), // JD TDB (~TT)
    a: num(el.a, 'a'),
    e: num(el.e, 'e'),
    iDeg: num(el.i, 'i'),
    OmegaDeg: num(el.om, 'om'),
    omegaDeg: num(el.w, 'w'),
    MDeg: num(el.ma, 'ma'),
    H: num(phys.H, 'H'),
    G: phys.G !== undefined && phys.G !== null ? num(phys.G, 'G') : 0.15,
    source: 'JPL SBDB',
    fetchedAt,
  };
}

function horizonsUrl(params) {
  const q = Object.entries({ format: 'json', ...params })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${HORIZONS}?${q}`;
}

async function horizons(params) {
  const url = horizonsUrl(params);
  const d = await getJson(url);
  const text = d.result;
  if (typeof text !== 'string') throw new Error(`Horizons: no result field (${url})`);
  const s = text.indexOf('$$SOE');
  const e = text.indexOf('$$EOE');
  if (s < 0 || e < 0 || e < s) throw new Error(`Horizons: missing $$SOE/$$EOE (${url})\n${text.slice(0, 600)}`);
  const lines = text.slice(s + 5, e).split('\n').map((l) => l.trim()).filter(Boolean);
  return { url, text, lines };
}

function cols(line) {
  return line.split(',').map((c) => c.trim());
}

async function observerFixture(id, name, center, centerLabel, epochJd, range) {
  const start = range ? range[0] : epochJd - HALF_WINDOW_DAYS;
  const stop = range ? range[1] : epochJd + HALF_WINDOW_DAYS;
  const { url, text, lines } = await horizons({
    COMMAND: `'${id};'`,
    CENTER: `'${center}'`,
    EPHEM_TYPE: 'OBSERVER',
    START_TIME: `'JD ${start}'`,
    STOP_TIME: `'JD ${stop}'`,
    STEP_SIZE: `'1 d'`,
    QUANTITIES: `'1,20'`,
    ANG_FORMAT: `'DEG'`,
    CSV_FORMAT: `'YES'`,
    TIME_TYPE: `'UT'`,
    CAL_FORMAT: `'JD'`,
  });
  // CSV: JD, solar-flag, lunar-flag, RA, DEC, delta, deldot,
  const rows = lines.map((l) => {
    const c = cols(l);
    return {
      jdUtc: num(c[0], 'jd'),
      raDeg: num(c[3], 'ra'),
      decDeg: num(c[4], 'dec'),
      deltaAu: num(c[5], 'delta'),
    };
  });
  const fixture = { body: name, id: String(id), center: centerLabel, timeScale: 'UTC', rows, query: url };
  if (center.includes('@399') && !center.startsWith('500')) {
    const m = text.match(/Center geodetic\s*:\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)/);
    if (!m) throw new Error('Horizons: site geodetic line not found');
    fixture.site = { latDeg: Number(m[2]), lonEastDeg: Number(m[1]), elevM: Number(m[3]) * 1000 };
  }
  return fixture;
}

// Osculating heliocentric ecliptic-J2000 elements at the middle epoch of each triplet.
async function elementsFixture(id, name, startUtc) {
  const out = [];
  for (const [spacing, offset] of [[10, 10], [5, 5]]) {
    const jdUtc = startUtc + offset;
    const jdTt = jdUtc + TT_MINUS_UTC_DAYS;
    const { url, lines } = await horizons({
      COMMAND: `'${id};'`,
      CENTER: `'500@10'`,
      EPHEM_TYPE: 'ELEMENTS',
      REF_PLANE: `'ECLIPTIC'`,
      REF_SYSTEM: `'J2000'`,
      OUT_UNITS: `'AU-D'`,
      TLIST: `'${jdTt}'`,
      CSV_FORMAT: `'YES'`,
      TIME_TYPE: `'TDB'`,
    });
    // CSV: JDTDB, calendar, EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR,
    const c = cols(lines[0]);
    out.push({
      spacingDays: spacing,
      jdUtcMid: jdUtc,
      jdTdb: num(c[0], 'jd'),
      e: num(c[2], 'ec'), iDeg: num(c[4], 'in'), OmegaDeg: num(c[5], 'om'),
      omegaDeg: num(c[6], 'w'), MDeg: num(c[9], 'ma'), a: num(c[11], 'a'),
      query: url,
    });
  }
  return { body: name, id: String(id), center: '500@10', frame: 'ecliptic J2000', timeScale: 'TDB', purpose: 'Osculating elements at triplet middle epochs for real-data IOD validation', rows: out };
}

async function earthFixture() {
  const { url, lines } = await horizons({
    COMMAND: `'399'`,
    CENTER: `'500@10'`,
    EPHEM_TYPE: 'VECTORS',
    REF_PLANE: `'FRAME'`,
    OUT_UNITS: `'AU-D'`,
    VEC_TABLE: `'2'`,
    CSV_FORMAT: `'YES'`,
    START_TIME: `'2000-01-01'`,
    STOP_TIME: `'2050-01-01'`,
    STEP_SIZE: `'1 y'`,
  });
  // CSV: JDTDB, calendar, X, Y, Z, VX, VY, VZ,
  const rows = lines.map((l) => {
    const c = cols(l);
    return {
      jdTdb: num(c[0], 'jd'),
      x: num(c[2], 'x'), y: num(c[3], 'y'), z: num(c[4], 'z'),
      vx: num(c[5], 'vx'), vy: num(c[6], 'vy'), vz: num(c[7], 'vz'),
    };
  });
  return { body: 'Earth', center: '500@10', frame: 'ICRF equatorial J2000', units: 'AU, AU/day', timeScale: 'TDB', rows, query: url };
}

// Daily geocenter-of-Earth heliocentric vectors over the Ceres opposition window, sampled at the TDB
// instants that match the UTC rows of ceres-opposition-*.json (jdTdb = jdUtc + TT-UTC). Same params as earth.json.
async function earthWindowFixture(startUtc) {
  const start = startUtc + TT_MINUS_UTC_DAYS;
  const { url, lines } = await horizons({
    COMMAND: `'399'`,
    CENTER: `'500@10'`,
    EPHEM_TYPE: 'VECTORS',
    REF_PLANE: `'FRAME'`,
    OUT_UNITS: `'AU-D'`,
    VEC_TABLE: `'2'`,
    CSV_FORMAT: `'YES'`,
    TIME_TYPE: `'TDB'`,
    START_TIME: `'JD ${start}'`,
    STOP_TIME: `'JD ${start + 40}'`,
    STEP_SIZE: `'1 d'`,
  });
  const rows = lines.map((l, k) => {
    const c = cols(l);
    return {
      jdUtc: startUtc + k,
      jdTdb: num(c[0], 'jd'),
      x: num(c[2], 'x'), y: num(c[3], 'y'), z: num(c[4], 'z'),
      vx: num(c[5], 'vx'), vy: num(c[6], 'vy'), vz: num(c[7], 'vz'),
    };
  });
  return { body: 'Earth', center: '500@10', frame: 'ICRF equatorial J2000', units: 'AU, AU/day', timeScale: 'TDB', purpose: 'Daily Earth vectors over the Ceres opposition window (row k = day k) for the Horizons-Earth control test', rows, query: url };
}

async function main() {
  if (process.argv.includes('--earth-window-only')) {
    const f = await earthWindowFixture(OPPOSITION_START[1]);
    await writeJsonAtomic(resolve(ROOT, 'tests/fixtures/horizons/earth-ceres-opposition.json'), f);
    console.log('done');
    return;
  }
  const fetchedAt = new Date().toISOString();
  const catalog = [];
  for (const [id, name] of BODIES) {
    console.log(`SBDB ${id} ${name}`);
    catalog.push(await fetchBody(id, name, fetchedAt));
  }
  for (const p of ['mars', 'jupiter', 'saturn']) {
    catalog.push({ id: p, name: p[0].toUpperCase() + p.slice(1), kind: 'planet', source: 'Standish' });
  }

  const fixtures = [];
  for (const id of FIXTURE_BODIES) {
    const b = catalog.find((c) => c.id === String(id));
    const slug = b.name.toLowerCase();
    console.log(`Horizons ${slug} geocentric`);
    fixtures.push([`${slug}-geocentric.json`, await observerFixture(id, b.name, '500@399', '500@399', b.epochJdTt)]);
    console.log(`Horizons ${slug} site ${SITE}`);
    fixtures.push([`${slug}-${SITE}.json`, await observerFixture(id, b.name, `${SITE}@399`, `${SITE}@399`, b.epochJdTt)]);
  }
  for (const id of FIXTURE_BODIES) {
    const b = catalog.find((c) => c.id === String(id));
    const slug = b.name.toLowerCase();
    const start = OPPOSITION_START[id];
    const range = [start, start + 40];
    const purpose = 'Opposition window (41 daily rows from day 0 = max solar elongation start) for real-data IOD validation';
    console.log(`Horizons ${slug} opposition geocentric`);
    fixtures.push([`${slug}-opposition-geocentric.json`, { ...(await observerFixture(id, b.name, '500@399', '500@399', start, range)), purpose }]);
    console.log(`Horizons ${slug} opposition site ${SITE}`);
    fixtures.push([`${slug}-opposition-${SITE}.json`, { ...(await observerFixture(id, b.name, `${SITE}@399`, `${SITE}@399`, start, range)), purpose }]);
    console.log(`Horizons ${slug} opposition elements`);
    fixtures.push([`${slug}-opposition-elements.json`, await elementsFixture(id, b.name, start)]);
  }
  console.log('Horizons earth vectors');
  fixtures.push(['earth.json', await earthFixture()]);
  console.log('Horizons earth daily vectors (Ceres opposition window)');
  fixtures.push(['earth-ceres-opposition.json', await earthWindowFixture(OPPOSITION_START[1])]);

  // All fetches succeeded; only now write (each atomically).
  await writeJsonAtomic(resolve(ROOT, 'src/data/catalog.json'), catalog);
  for (const [file, data] of fixtures) {
    await writeJsonAtomic(resolve(ROOT, 'tests/fixtures/horizons', file), data);
  }
  console.log('done');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
