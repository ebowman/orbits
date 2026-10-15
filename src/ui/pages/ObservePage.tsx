import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  calendarToJd,
  formatDec,
  formatRA,
  jdToCalendar,
  loadCatalog,
  parseDec,
  parseRA,
  predict,
  seededGaussian,
  validateObservations,
  type Observation,
  type Site,
} from '@astro';
import { useStore, type NamedSite, type RowDraft } from '../store';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const ARCSEC = Math.PI / (180 * 3600);

/** Parse a datetime-local value ("YYYY-MM-DDTHH:MM[:SS]") as UTC; returns JD(UTC). Throws on bad input. */
export function parseUtcInput(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(value.trim());
  if (!m) throw new Error('Enter a date and time (UTC).');
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number) as [
    number, number, number, number, number, number,
  ];
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (mo < 1 || mo > 12 || d < 1 || d > (dim ?? 31) || h > 23 || mi > 59 || s > 59) {
    throw new Error('Date or time out of range (check the day of the month).');
  }
  return calendarToJd(y, mo, d, h, mi, s);
}

/** Format JD(UTC) as a datetime-local value, rounded to the nearest second. */
export function jdToUtcInput(jd: number): string {
  const c = jdToCalendar(jd + 0.5 / 86400);
  return `${pad(c.year, 4)}-${pad(c.month)}-${pad(c.day)}T${pad(c.hour)}:${pad(c.minute)}:${pad(Math.floor(c.second))}`;
}

const sameSite = (a: Site | null, b: Site | null) =>
  a === null || b === null
    ? a === b
    : a.latDeg === b.latDeg && a.lonEastDeg === b.lonEastDeg && a.elevM === b.elevM;
const copySite = (s: NamedSite | undefined): Site | null =>
  s ? { latDeg: s.latDeg, lonEastDeg: s.lonEastDeg, elevM: s.elevM } : null;

type Row = RowDraft;
const GEO = 'geocenter';
const STORED_PREFIX = 'stored:';
const EMPTY_ROW: RowDraft = { utc: '', ra: '', dec: '', siteKey: GEO };

function storedKey(site: Site): string {
  return `${STORED_PREFIX}${site.latDeg},${site.lonEastDeg},${site.elevM}`;
}
function storedFromKey(key: string): Site | null {
  if (!key.startsWith(STORED_PREFIX)) return null;
  const parts = key.slice(STORED_PREFIX.length).split(',').map(Number);
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) return null;
  return { latDeg: parts[0]!, lonEastDeg: parts[1]!, elevM: parts[2]! };
}

function rowFromObs(o: Observation | undefined, sites: NamedSite[]): Row {
  if (!o) return { ...EMPTY_ROW };
  const match = o.site ? sites.find((s) => sameSite(copySite(s), o.site)) : undefined;
  return {
    utc: jdToUtcInput(o.jdUtc),
    ra: formatRA(o.raRad, 2),
    dec: formatDec(o.decRad, 1),
    siteKey: o.site === null ? GEO : match ? match.id : storedKey(o.site),
  };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string } | { ok: 'empty' };
function attempt<T>(text: string, fn: (t: string) => T): Parsed<T> {
  if (text.trim() === '') return { ok: 'empty' };
  try {
    return { ok: true, value: fn(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function resolveSite(row: Row, sites: NamedSite[]): { site: Site | null; ok: boolean } {
  if (row.siteKey === GEO) return { site: null, ok: true };
  if (row.siteKey.startsWith(STORED_PREFIX)) {
    const st = storedFromKey(row.siteKey);
    return { site: st, ok: st !== null };
  }
  const s = sites.find((x) => x.id === row.siteKey);
  return { site: copySite(s), ok: s !== undefined };
}

function parseRow(row: Row, sites: NamedSite[], n: number | string, label?: string) {
  const dt = attempt(row.utc, parseUtcInput);
  const ra = attempt(row.ra, parseRA);
  const dec = attempt(row.dec, parseDec);
  const site = resolveSite(row, sites);
  let obs: Observation | null = null;
  if (dt.ok === true && ra.ok === true && dec.ok === true && site.ok) {
    obs = { jdUtc: dt.value, raRad: ra.value, decRad: dec.value, site: site.site, label: label ?? `Obs ${n}` };
  }
  return { dt, ra, dec, obs };
}

/** Check-row time must differ from every valid IOD time by more than 1 s. */
function checkDuplicateError(rows: Row[], checkRow: Row | null): string | null {
  if (!checkRow) return null;
  const c = attempt(checkRow.utc, parseUtcInput);
  if (c.ok !== true) return null;
  for (const r of rows) {
    const d = attempt(r.utc, parseUtcInput);
    if (d.ok === true && Math.abs(d.value - c.value) * 86400 < 1) {
      return 'The check observation time must differ from the three observation times by more than 1 second.';
    }
  }
  return null;
}

function ObsRows({ setId }: { setId: string }) {
  const sites = useStore((s) => s.sites);
  const updateSet = useStore((s) => s.updateSet);
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>(() => {
    const st = useStore.getState();
    const set = st.observationSets.find((x) => x.id === setId);
    if (set?.drafts) return set.drafts.map((d) => ({ ...d }));
    return [0, 1, 2].map((i) => rowFromObs(set?.observations[i], st.sites));
  });
  const [checkRow, setCheckRow] = useState<Row | null>(() => {
    const st = useStore.getState();
    const set = st.observationSets.find((x) => x.id === setId);
    if (set?.checkDraft) return { ...set.checkDraft };
    if (set?.check) return rowFromObs(set.check, st.sites);
    return null;
  });

  const parsed = useMemo(() => rows.map((r, i) => parseRow(r, sites, i + 1)), [rows, sites]);
  const checkParsed = useMemo(
    () => (checkRow ? parseRow(checkRow, sites, 'check', 'Check obs') : null),
    [checkRow, sites],
  );
  const dupError = checkDuplicateError(rows, checkRow);

  const commit = (next: Row[], nextCheck: Row | null) => {
    setRows(next);
    setCheckRow(nextCheck);
    const sts = useStore.getState().sites;
    const obs = next.map((r, i) => parseRow(r, sts, i + 1).obs);
    const all = obs.every((o) => o !== null);
    const checkObs =
      nextCheck && !checkDuplicateError(next, nextCheck) ? parseRow(nextCheck, sts, 'check', 'Check obs').obs : null;
    updateSet(setId, {
      drafts: next.map((r) => ({ ...r })) as [RowDraft, RowDraft, RowDraft],
      observations: all ? (obs as Observation[]) : [],
      checkDraft: nextCheck ? { ...nextCheck } : undefined,
      check: checkObs ?? undefined,
    });
  };
  const patch = (i: number, p: Partial<Row>) => commit(rows.map((r, j) => (j === i ? { ...r, ...p } : r)), checkRow);
  const patchCheck = (p: Partial<Row>) => commit(rows, { ...(checkRow ?? EMPTY_ROW), ...p });

  const allObs = parsed.map((p) => p.obs);
  const complete = allObs.every((o) => o !== null);
  let error: string | null = null;
  let warnings: string[] = [];
  if (complete) {
    try {
      warnings = validateObservations(allObs as Observation[]).warnings;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }
  const canSolve = complete && error === null;

  const renderRow = (r: Row, p: ReturnType<typeof parseRow>, n: number | string, legend: string, on: (q: Partial<Row>) => void) => (
    <fieldset key={String(n)} className="obs-row">
      <legend>{legend}</legend>
      <label>
        Date/time (UTC)
        <input type="datetime-local" step="1" value={r.utc} onChange={(e) => on({ utc: e.target.value })} />
      </label>
      {p.dt.ok === true && <span> JD {p.dt.value}</span>}
      {p.dt.ok === false && <span role="alert" className="error"> {p.dt.error}</span>}
      <label>
        RA {n}
        <input type="text" value={r.ra} placeholder="hh mm ss.s" onChange={(e) => on({ ra: e.target.value })} />
      </label>
      {p.ra.ok === true && <span data-testid={`ra-echo-${n}`}> = {formatRA(p.ra.value, 2)}</span>}
      {p.ra.ok === false && <span role="alert" className="error"> {p.ra.error}</span>}
      <label>
        Dec {n}
        <input type="text" value={r.dec} placeholder="+dd mm ss" onChange={(e) => on({ dec: e.target.value })} />
      </label>
      {p.dec.ok === true && <span data-testid={`dec-echo-${n}`}> = {formatDec(p.dec.value, 1)}</span>}
      {p.dec.ok === false && <span role="alert" className="error"> {p.dec.error}</span>}
      <label>
        Site {n}
        <select value={r.siteKey} onChange={(e) => on({ siteKey: e.target.value })}>
          <option value={GEO}>Geocenter (none)</option>
          {storedFromKey(r.siteKey) && (
            <option value={r.siteKey}>
              Stored ({storedFromKey(r.siteKey)!.latDeg}, {storedFromKey(r.siteKey)!.lonEastDeg})
            </option>
          )}
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );

  return (
    <div>
      {rows.map((r, i) => renderRow(r, parsed[i]!, i + 1, `Observation ${i + 1}`, (q) => patch(i, q)))}
      <label>
        <input
          type="checkbox"
          checked={checkRow !== null}
          onChange={(e) => commit(rows, e.target.checked ? { ...EMPTY_ROW } : null)}
        />
        Add a 4th check observation (optional)
      </label>
      {checkRow && checkParsed && renderRow(checkRow, checkParsed, 'check', 'Check observation', patchCheck)}
      {dupError && (
        <p role="alert" className="error" data-testid="check-error">
          {dupError}
        </p>
      )}
      {error && (
        <p role="alert" className="error" data-testid="set-error">
          {error}
        </p>
      )}
      {warnings.map((w) => (
        <p key={w} className="warning" style={{ color: 'orange' }} data-testid="set-warning">
          {w}
        </p>
      ))}
      <button type="button" disabled={!canSolve} onClick={() => navigate('/solve')}>
        Solve this set
      </button>
    </div>
  );
}

function SetManager() {
  const sets = useStore((s) => s.observationSets);
  const activeId = useStore((s) => s.activeSetId);
  const { addSet, setActiveSet, updateSet, removeSet } = useStore.getState();
  const [confirming, setConfirming] = useState(false);
  const active = sets.find((x) => x.id === activeId);

  return (
    <div>
      <label>
        Active set
        <select
          value={active?.id ?? ''}
          onChange={(e) => {
            setConfirming(false);
            setActiveSet(e.target.value || null);
          }}
        >
          <option value="">(none)</option>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.synthetic ? ' [synthetic]' : ''}
            </option>
          ))}
        </select>
      </label>{' '}
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
          const id = addSet({ name: `Set ${sets.length + 1}`, observations: [] });
          setActiveSet(id);
        }}
      >
        New set
      </button>
      {active && (
        <div>
          <label>
            Set name
            <input type="text" value={active.name} onChange={(e) => updateSet(active.id, { name: e.target.value })} />
          </label>{' '}
          {active.synthetic && <span>(synthetic)</span>}{' '}
          {!confirming ? (
            <button type="button" onClick={() => setConfirming(true)}>
              Delete set
            </button>
          ) : (
            <span>
              Delete &quot;{active.name}&quot;?{' '}
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  removeSet(active.id);
                }}
              >
                Confirm delete
              </button>{' '}
              <button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

const normLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

function SiteManager() {
  const sites = useStore((s) => s.sites);
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [elev, setElev] = useState('0');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const num = (t: string) => (t.trim() === '' ? NaN : Number(t));

  const add = () => {
    const la = num(lat);
    const lo = num(lon);
    const el = num(elev);
    if (name.trim() === '') return setErr('Site name is required.');
    if (!Number.isFinite(la) || la < -90 || la > 90) return setErr('Latitude must be a number from -90 to 90.');
    if (!Number.isFinite(lo) || lo < -180 || lo > 360) return setErr('Longitude (east) must be a number from -180 to 360.');
    if (!Number.isFinite(el)) return setErr('Elevation must be a number in metres.');
    setErr(null);
    useStore.getState().addSite({ name: name.trim(), latDeg: la, lonEastDeg: normLon(lo), elevM: el });
    setName('');
  };

  const locate = () => {
    setMsg(null);
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) {
      setMsg('Geolocation is not available in this browser; enter coordinates manually.');
      return;
    }
    geo.getCurrentPosition(
      (pos) => {
        setLat(String(pos.coords.latitude));
        setLon(String(pos.coords.longitude));
        setElev(String(pos.coords.altitude ?? 0));
        setName((n) => n || 'My location');
        setMsg('Location filled in; press Add site to save it.');
      },
      (e) =>
        setMsg(
          e.code === 1
            ? 'Location permission denied. Enter coordinates manually.'
            : `Could not get location (${e.message || 'unknown error'}). Enter coordinates manually.`,
        ),
    );
  };

  return (
    <div>
      <ul>
        {sites.map((s) => (
          <li key={s.id}>
            {s.name} ({s.latDeg}, {s.lonEastDeg}, {s.elevM} m){' '}
            <button type="button" onClick={() => useStore.getState().removeSite(s.id)} aria-label={`Remove site ${s.name}`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <label>
        Site name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Latitude (deg)
        <input type="text" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
      </label>
      <label>
        Longitude east (deg)
        <input type="text" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} />
      </label>
      <label>
        Elevation (m)
        <input type="text" inputMode="decimal" value={elev} onChange={(e) => setElev(e.target.value)} />
      </label>{' '}
      <button type="button" onClick={add}>
        Add site
      </button>{' '}
      <button type="button" onClick={locate}>
        Use my location
      </button>
      {err && (
        <p role="alert" className="error">
          {err}
        </p>
      )}
      {msg && <p role="status">{msg}</p>}
    </div>
  );
}

function SyntheticPanel() {
  const sites = useStore((s) => s.sites);
  const catalog = useMemo(() => loadCatalog().filter((c) => c.kind === 'asteroid'), []);
  const [bodyId, setBodyId] = useState(catalog[0]?.id ?? '');
  const [start, setStart] = useState('2026-01-01T00:00:00');
  const [spacing, setSpacing] = useState('7');
  const [siteVal, setSiteVal] = useState(GEO);
  const [sigma, setSigma] = useState('0');
  const [seed, setSeed] = useState('1');
  const [nObs, setNObs] = useState('3');
  const [err, setErr] = useState<string | null>(null);

  const generate = () => {
    try {
      const entry = catalog.find((c) => c.id === bodyId);
      if (!entry) throw new Error('Choose a catalog body.');
      const jd0 = parseUtcInput(start);
      const sp = Number(spacing);
      if (!Number.isFinite(sp) || sp <= 0) throw new Error('Spacing must be a positive number of days.');
      const sg = Number(sigma);
      if (!Number.isFinite(sg) || sg < 0) throw new Error('Noise sigma must be a non-negative number of arcseconds.');
      const sd = Number(seed);
      if (!Number.isInteger(sd)) throw new Error('Seed must be an integer.');
      const site = siteVal === GEO ? null : copySite(sites.find((s) => s.id === siteVal));
      if (siteVal !== GEO && !site) throw new Error('Selected site no longer exists.');
      const g = seededGaussian(sd);
      const all: Observation[] = (nObs === '4' ? [0, 1, 2, 3] : [0, 1, 2]).map((k) => {
        const jd = jd0 + k * sp;
        const p = predict(entry.body, jd, site);
        let ra = p.raRad;
        let dec = p.decRad;
        if (sg > 0) {
          const nRa = g() * sg * ARCSEC;
          const nDec = g() * sg * ARCSEC;
          ra += nRa / Math.cos(p.decRad);
          dec += nDec;
        }
        if (ra < 0 || ra >= 2 * Math.PI) ra = ((ra % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        return { jdUtc: jd, raRad: ra, decRad: dec, site: site ? { ...site } : null, label: k === 3 ? 'Synthetic check' : `Synthetic ${k + 1}` };
      });
      const observations = all.slice(0, 3);
      const check = all[3];
      const st = useStore.getState();
      const id = st.addSet({
        name: `${entry.name} synthetic ${start.slice(0, 10)}`,
        targetId: entry.id,
        synthetic: true,
        observations,
        ...(check ? { check } : {}),
      });
      st.setActiveSet(id);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <label>
        Body
        <select value={bodyId} onChange={(e) => setBodyId(e.target.value)}>
          {catalog.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Start (UTC)
        <input type="datetime-local" step="1" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label>
        Spacing (days)
        <input type="number" value={spacing} onChange={(e) => setSpacing(e.target.value)} />
      </label>
      <label>
        Synthetic site
        <select value={siteVal} onChange={(e) => setSiteVal(e.target.value)}>
          <option value={GEO}>Geocenter (none)</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Noise sigma (arcsec)
        <input type="number" value={sigma} onChange={(e) => setSigma(e.target.value)} />
      </label>
      <label>
        Observations
        <select value={nObs} onChange={(e) => setNObs(e.target.value)}>
          <option value="3">3</option>
          <option value="4">4 (3 + check)</option>
        </select>
      </label>
      <label>
        Seed
        <input type="number" value={seed} onChange={(e) => setSeed(e.target.value)} />
      </label>{' '}
      <button type="button" onClick={generate}>
        Generate synthetic set
      </button>
      {err && (
        <p role="alert" className="error">
          {err}
        </p>
      )}
    </div>
  );
}

export default function ObservePage() {
  const activeId = useStore((s) => s.activeSetId);
  const exists = useStore((s) => s.observationSets.some((x) => x.id === s.activeSetId));
  return (
    <section>
      <h1>Enter observations</h1>
      <h2>Observation set</h2>
      <SetManager />
      <h2>Observations</h2>
      {exists && activeId ? (
        <ObsRows key={activeId} setId={activeId} />
      ) : (
        <p>Create or select an observation set to enter observations.</p>
      )}
      <h2>Observing sites</h2>
      <SiteManager />
      <h2>Synthetic observations</h2>
      <SyntheticPanel />
    </section>
  );
}
