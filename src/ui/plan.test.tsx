// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PlanPage from './pages/PlanPage';
import ObservePage from './pages/ObservePage';
import { useStore } from './store';

vi.hoisted(() => {
  const m = new Map<string, string>();
  const mem = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: mem, configurable: true });
});

const initial = useStore.getState();
beforeEach(() => {
  localStorage.clear();
  useStore.setState({ ...initial, sites: [], observationSets: [], selectedSiteId: null, activeSetId: null });
});
afterEach(cleanup);

function mount() {
  render(
    <MemoryRouter initialEntries={['/plan']}>
      <Routes>
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/observe" element={<ObservePage />} />
      </Routes>
    </MemoryRouter>,
  );
}
function withSite() {
  const id = useStore.getState().addSite({ name: 'Mauna Kea', latDeg: 19.8260847, lonEastDeg: 204.5278, elevM: 4210 });
  useStore.getState().selectSite(id);
  return id;
}
const setDate = () => fireEvent.change(screen.getByLabelText(/Date/), { target: { value: '2026-11-20' } });
const names = () => screen.queryAllByTestId('plan-row').map((r) => within(r).getAllByRole('cell')[0]!.textContent);
const cellsOf = (col: number) =>
  screen.queryAllByTestId('plan-row').map((r) => within(r).getAllByRole('cell')[col]?.textContent ?? '');

describe('PlanPage', () => {
  it('prompts with a link to /observe when there is no site', () => {
    mount();
    const link = screen.getByRole('link', { name: /Add a site/ });
    expect(link.getAttribute('href')).toBe('/observe');
  });

  it('filter toggle widens the table; unfiltered shows not-observable rows; sorting works', () => {
    withSite();
    mount();
    setDate();
    const filteredCount = names().length;
    const toggle = screen.getByLabelText(/max alt/) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    const all = names();
    expect(all.length).toBe(11);
    expect(all.length).toBeGreaterThan(filteredCount);
    // Max alt sort (default): observable rows descending.
    const alts = cellsOf(1).filter((t) => t.endsWith('°')).map((t) => parseFloat(t));
    expect(alts.length).toBeGreaterThan(2);
    for (let i = 1; i < alts.length; i++) expect(alts[i]!).toBeLessThanOrEqual(alts[i - 1]!);
    // V sort: ascending numeric V, planets (approx n/a) last among observable.
    fireEvent.click(screen.getByRole('button', { name: 'V' }));
    const vs = cellsOf(5).filter((t) => t !== '' && t !== 'approx n/a' && !Number.isNaN(parseFloat(t))).map(parseFloat);
    expect(vs.length).toBeGreaterThan(2);
    for (let i = 1; i < vs.length; i++) expect(vs[i]!).toBeGreaterThanOrEqual(vs[i - 1]!);
    // Filter on: every shown row meets alt > 30 and V < 10.
    fireEvent.click(toggle);
    for (const r of screen.queryAllByTestId('plan-row')) {
      const c = within(r).getAllByRole('cell');
      expect(parseFloat(c[1]!.textContent!)).toBeGreaterThan(30);
      const v = c[5]!.textContent!;
      if (v !== 'approx n/a') expect(parseFloat(v)).toBeLessThan(10);
    }
  });

  it('shows not observable tonight when there is no dark window (polar day)', () => {
    const id = useStore.getState().addSite({ name: 'Svalbard', latDeg: 78, lonEastDeg: 15, elevM: 0 });
    useStore.getState().selectSite(id);
    mount();
    fireEvent.change(screen.getByLabelText(/Date/), { target: { value: '2026-06-25' } });
    fireEvent.click(screen.getByLabelText(/max alt/));
    expect(screen.getAllByText('not observable tonight')).toHaveLength(11);
  });

  it('plan button creates a set and the Observe page shows prefilled times', () => {
    const siteId = withSite();
    mount();
    setDate();
    const sel = screen.getByLabelText<HTMLSelectElement>('Body');
    const opt = [...sel.options].find((o) => o.textContent === 'Ceres')!;
    fireEvent.change(sel, { target: { value: opt.value } });
    fireEvent.click(screen.getByRole('button', { name: 'Create observation set from this plan' }));
    const st = useStore.getState();
    const set = st.observationSets.find((s) => s.id === st.activeSetId)!;
    expect(set.name).toMatch(/ plan 2026-11-20$/);
    expect(set.name).toMatch(/^Ceres plan /);
    expect(set.targetId).toBe(opt.value);
    expect(set.observations).toEqual([]);
    expect(set.drafts!.map((d) => d.siteKey)).toEqual([siteId, siteId, siteId]);
    expect(set.drafts!.every((d) => d.ra === '' && d.dec === '')).toBe(true);
    const times = set.drafts!.map((d) => d.utc);
    // First night is the Nov 20 local evening = Nov 21 UTC, 04:00-16:00.
    expect(times[0]!.startsWith('2026-11-21T')).toBe(true);
    const hr = Number(times[0]!.slice(11, 13));
    expect(hr >= 4 && hr <= 16).toBe(true);
    expect(times[1]!.startsWith('2026-11-28T')).toBe(true);
    expect(times.every((t) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(t))).toBe(true);
    // Navigated to Observe, inputs prefilled.
    screen.getByRole('heading', { name: 'Enter observations' });
    [1, 2, 3].forEach((n, i) => {
      const f = within(screen.getByRole('group', { name: `Observation ${n}` })).getByLabelText('Date/time (UTC)') as HTMLInputElement;
      expect(f.value.startsWith(times[i]!)).toBe(true);
    });
  });
});
