import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  RAD2DEG,
  bodyVisibility,
  darkWindow,
  formatDec,
  formatRA,
  loadCatalog,
  suggestPlan,
  type BodyVisibility,
  type DateUtc,
  type Site,
} from '@astro';
import { jdToUtcInput } from './ObservePage';
import { useStore, type RowDraft } from '../store';

const pad = (n: number) => String(n).padStart(2, '0');
const todayUtc = (): string => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
function parseDate(s: string): DateUtc | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

type SortKey = 'v' | 'alt';
type Row = { id: string; name: string; vis: BodyVisibility | null };

const catalog = loadCatalog();

export default function PlanPage() {
  const sites = useStore((s) => s.sites);
  const selectedSiteId = useStore((s) => s.selectedSiteId);
  const selectSite = useStore((s) => s.selectSite);
  const navigate = useNavigate();
  const [dateStr, setDateStr] = useState(todayUtc);
  const [filterOn, setFilterOn] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('alt');
  const [planBodyId, setPlanBodyId] = useState(() => catalog.find((c) => c.kind === 'asteroid')?.id ?? catalog[0]!.id);
  const [spacing, setSpacing] = useState(7);

  const site = sites.find((s) => s.id === selectedSiteId) ?? sites[0];
  const date = parseDate(dateStr);
  const siteKey = site ? `${site.id}|${site.latDeg}|${site.lonEastDeg}|${site.elevM}` : '';

  const rows: Row[] = useMemo(() => {
    if (!site || !date) return [];
    const s: Site = { latDeg: site.latDeg, lonEastDeg: site.lonEastDeg, elevM: site.elevM };
    const w = darkWindow(s, date);
    return catalog.map((c) => {
      const vis = bodyVisibility(c, s, w);
      return { id: c.id, name: c.name, vis: vis && vis.maxAltRad > 0 ? vis : null };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr, siteKey]);

  const plan = useMemo(() => {
    const c = catalog.find((x) => x.id === planBodyId);
    if (!site || !date || !c) return null;
    const s: Site = { latDeg: site.latDeg, lonEastDeg: site.lonEastDeg, elevM: site.elevM };
    return { entry: c, nights: suggestPlan(c, s, date, spacing) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr, siteKey, planBodyId, spacing]);

  if (!site) {
    return (
      <section>
        <h1>Plan observations</h1>
        <p>
          Planning needs an observing site. <Link to="/observe">Add a site on the Observe page</Link>.
        </p>
      </section>
    );
  }

  const shown = rows
    .filter((r) => {
      if (!filterOn) return true;
      if (!r.vis) return false;
      // Planets have no V (approx n/a): they pass the magnitude criterion.
      return r.vis.maxAltDeg > 30 && (r.vis.v === null || r.vis.v < 10);
    })
    .sort((a, b) => {
      if (!a.vis || !b.vis) return a.vis ? -1 : b.vis ? 1 : a.name.localeCompare(b.name);
      if (sortKey === 'alt') return b.vis.maxAltRad - a.vis.maxAltRad;
      const av = a.vis.v ?? Infinity;
      const bv = b.vis.v ?? Infinity;
      return av - bv;
    });

  const createSet = () => {
    if (!plan) return;
    const st = useStore.getState();
    const iso = `${plan.nights[0]!.date.year}-${pad(plan.nights[0]!.date.month)}-${pad(plan.nights[0]!.date.day)}`;
    const drafts = plan.nights.map((n) => ({
      utc: n.best ? jdToUtcInput(n.best.jd) : '',
      ra: '',
      dec: '',
      siteKey: site.id,
    })) as [RowDraft, RowDraft, RowDraft];
    const id = st.addSet({ name: `${plan.entry.name} plan ${iso}`, targetId: plan.entry.id, drafts, observations: [] });
    st.setActiveSet(id);
    navigate('/observe');
  };

  return (
    <section>
      <h1>Plan observations</h1>
      <p>
        <label>
          Site{' '}
          <select value={site.id} onChange={(e) => selectSite(e.target.value)}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          Date (UTC evening){' '}
          <input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
        </label>{' '}
        <label>
          <input type="checkbox" checked={filterOn} onChange={(e) => setFilterOn(e.target.checked)} /> max alt &gt; 30° and V &lt; 10
        </label>
      </p>
      {!date && <p role="alert">Enter a valid date.</p>}
      <table className="solve-table">
        <thead>
          <tr>
            <th>Body</th>
            <th aria-sort={sortKey === 'alt' ? 'descending' : 'none'}>
              <button type="button" onClick={() => setSortKey('alt')}>Max alt</button>
            </th>
            <th>At time (UTC)</th>
            <th>RA</th>
            <th>Dec</th>
            <th aria-sort={sortKey === 'v' ? 'ascending' : 'none'}>
              <button type="button" onClick={() => setSortKey('v')}>V</button>
            </th>
            <th>Elongation</th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && (
            <tr>
              <td colSpan={7}>No bodies match.</td>
            </tr>
          )}
          {shown.map((r) =>
            r.vis ? (
              <tr key={r.id} data-testid="plan-row">
                <td>{r.name}</td>
                <td>{r.vis.maxAltDeg.toFixed(1)}°</td>
                <td>{jdToUtcInput(r.vis.jdMaxAlt).replace('T', ' ')}</td>
                <td>{formatRA(r.vis.raRad, 1)}</td>
                <td>{formatDec(r.vis.decRad, 0)}</td>
                <td>{r.vis.v === null ? 'approx n/a' : r.vis.v.toFixed(1)}</td>
                <td>{(r.vis.elongationRad * RAD2DEG).toFixed(0)}°</td>
              </tr>
            ) : (
              <tr key={r.id} data-testid="plan-row">
                <td>{r.name}</td>
                <td colSpan={6}>not observable tonight</td>
              </tr>
            ),
          )}
        </tbody>
      </table>

      <h2>Suggested schedule</h2>
      <p>
        <label>
          Body{' '}
          <select value={planBodyId} onChange={(e) => setPlanBodyId(e.target.value)}>
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          Spacing (days){' '}
          <input
            type="number"
            min={1}
            max={60}
            value={spacing}
            onChange={(e) => setSpacing(Math.max(1, Math.min(60, Math.round(Number(e.target.value)) || 7)))}
          />
        </label>
      </p>
      <ol>
        {plan?.nights.map((n, i) => (
          <li key={i}>
            {n.date.year}-{pad(n.date.month)}-{pad(n.date.day)}:{' '}
            {n.best
              ? `${jdToUtcInput(n.best.jd).replace('T', ' ')} UTC, alt ${n.best.altDeg.toFixed(0)}°, RA ${formatRA(n.best.raRad, 1)}, Dec ${formatDec(n.best.decRad, 0)}`
              : 'not observable'}
          </li>
        ))}
      </ol>
      <button type="button" onClick={createSet}>Create observation set from this plan</button>
    </section>
  );
}
