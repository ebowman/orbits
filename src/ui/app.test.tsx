// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App, { Layout, Nav } from './App';
import { exportSet, importSet, useStore } from './store';

// Node 25 ships a broken global localStorage that shadows jsdom's; install a plain in-memory one.
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
  useStore.setState({ ...initial, sites: [], observationSets: [], selectedSiteId: null, activeSetId: null, nightMode: false });
});
afterEach(cleanup);

const routes: [string, string][] = [
  ['/', 'Orbits'],
  ['/plan', 'Plan observations'],
  ['/observe', 'Enter observations'],
  ['/solve', 'Solve orbit'],
  ['/learn/gauss', 'Learn: Gauss method'],
  ['/learn/laplace', 'Learn: Laplace method'],
  ['/explore', 'Explore sensitivity'],
];

describe('routing', () => {
  it.each(routes)('MemoryRouter %s renders heading', async (path, heading) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Layout />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy();
  });

  it('HashRouter App follows window.location.hash', () => {
    window.location.hash = '#/solve';
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Solve orbit' })).toBeTruthy();
  });
});

describe('nav', () => {
  it('menu button toggles aria-expanded', () => {
    render(
      <MemoryRouter>
        <Nav />
      </MemoryRouter>,
    );
    const btn = screen.getByRole('button', { name: /navigation menu/i });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('night mode toggle sets data-night', () => {
    render(
      <MemoryRouter>
        <Layout />
      </MemoryRouter>,
    );
    expect(document.documentElement.dataset.night).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: /red night mode/i }));
    expect(document.documentElement.dataset.night).toBe('red');
  });
});

const obs = (jd: number) => ({ jdUtc: jd, raRad: 1, decRad: 0.5, site: { latDeg: 10, lonEastDeg: 20, elevM: 30 }, label: 'x' });

describe('store', () => {
  it('persists and rehydrates from localStorage', async () => {
    const st = useStore.getState();
    const siteId = st.addSite({ name: 'Home', latDeg: 1, lonEastDeg: 2, elevM: 3 });
    st.selectSite(siteId);
    const setId = st.addSet({ name: 'A', observations: [obs(2460000.5)] });
    st.setActiveSet(setId);
    const raw = localStorage.getItem('orbits-v1');
    expect(raw).toBeTruthy();
    useStore.setState({ sites: [], observationSets: [], selectedSiteId: null, activeSetId: null });
    localStorage.setItem('orbits-v1', raw as string);
    await useStore.persist.rehydrate();
    const s = useStore.getState();
    expect(s.sites[0]?.name).toBe('Home');
    expect(s.selectedSiteId).toBe(siteId);
    expect(s.observationSets[0]?.observations[0]?.jdUtc).toBe(2460000.5);
    expect(s.activeSetId).toBe(setId);
  });

  it('update/remove actions', () => {
    const st = useStore.getState();
    const id = st.addSite({ name: 'S', latDeg: 0, lonEastDeg: 0, elevM: 0 });
    st.selectSite(id);
    st.updateSite(id, { name: 'T' });
    expect(useStore.getState().sites[0]?.name).toBe('T');
    st.removeSite(id);
    expect(useStore.getState().selectedSiteId).toBeNull();
  });
});

describe('import/export', () => {
  it('round-trips with a fresh id', () => {
    const id = useStore.getState().addSet({ name: 'A', targetId: 'ceres', synthetic: true, observations: [obs(1), { ...obs(2), site: null }, obs(3)] });
    const newIdv = importSet(exportSet(id));
    expect(newIdv).not.toBe(id);
    const sets = useStore.getState().observationSets;
    const [a, b] = [sets[0], sets[1]];
    expect({ ...b, id: '' }).toEqual({ ...a, id: '' });
  });

  it('rejects bad input', () => {
    expect(() => importSet('{nope')).toThrow(/not valid JSON/);
    expect(() => importSet(JSON.stringify({ schemaVersion: 2, set: {} }))).toThrow(/schemaVersion/);
    const mk = (o: unknown) => JSON.stringify({ schemaVersion: 1, set: { name: 'n', observations: [o] } });
    expect(() => importSet(mk({ jdUtc: 1, raRad: 1 }))).toThrow(/decRad/);
    expect(() => importSet(mk({ jdUtc: 1, raRad: 1, decRad: null }))).toThrow(/finite/);
    expect(() => importSet(mk({ jdUtc: 1, raRad: 1, decRad: 1, site: { latDeg: 'x' } }))).toThrow(/site/);
    expect(() => importSet(JSON.stringify({ schemaVersion: 1 }))).toThrow(/set/);
    expect(() => exportSet('missing')).toThrow(/No observation set/);
    expect(useStore.getState().observationSets).toHaveLength(0);
  });

  const O = { jdUtc: 1, raRad: 1, decRad: 1, site: null };
  const D = { utc: '', ra: '', dec: '', siteKey: 'geocenter' };
  const mkSet = (set: Record<string, unknown>) => JSON.stringify({ schemaVersion: 1, set: { name: 'n', ...set } });

  it('rejects missing jdUtc, missing raRad, and Infinity (1e999)', () => {
    const three = (o: unknown) => JSON.stringify({ schemaVersion: 1, set: { name: 'n', observations: [o, O, O] } });
    expect(() => importSet(three({ raRad: 1, decRad: 1 }))).toThrow(/jdUtc/);
    expect(() => importSet(three({ jdUtc: 1, decRad: 1 }))).toThrow(/raRad/);
    const inf = '{"schemaVersion":1,"set":{"name":"n","observations":[{"jdUtc":1e999,"raRad":1,"decRad":1,"site":null}]}}';
    expect(() => importSet(inf)).toThrow(/finite/);
    expect(useStore.getState().observationSets).toHaveLength(0);
  });

  it('requires 0 or 3 observations', () => {
    for (const n of [1, 2, 4]) {
      expect(() => importSet(mkSet({ observations: Array(n).fill(O) }))).toThrow(/0 or 3/);
    }
    expect(() => importSet(mkSet({ observations: [] }))).not.toThrow();
    expect(() => importSet(mkSet({ observations: [O, O, O] }))).not.toThrow();
  });

  it('validates drafts, check, checkDraft shapes; legacy sets import', () => {
    expect(() => importSet(mkSet({ observations: [O, O, O], drafts: [D, D] }))).toThrow(/drafts/);
    expect(() => importSet(mkSet({ observations: [O, O, O], drafts: [D, D, D, D] }))).toThrow(/drafts/);
    expect(() => importSet(mkSet({ observations: [], check: { jdUtc: 1, raRad: 1 } }))).toThrow(/check/);
    expect(() => importSet(mkSet({ observations: [], check: { jdUtc: null, raRad: 1, decRad: 1 } }))).toThrow(/check/);
    expect(() => importSet('{"schemaVersion":1,"set":{"name":"n","observations":[],"check":{"jdUtc":1e999,"raRad":1,"decRad":1}}}')).toThrow(/check/);
    expect(() => importSet(mkSet({ observations: [], checkDraft: { utc: 1 } }))).toThrow(/checkDraft/);
    expect(useStore.getState().observationSets).toHaveLength(0);
    expect(() => importSet(mkSet({ observations: [O, O, O], drafts: [D, D, D], check: O, checkDraft: D }))).not.toThrow();
    expect(() => importSet(mkSet({ observations: [O, O, O] }))).not.toThrow();
  });
});

describe('safe storage', () => {
  it('actions do not throw when localStorage writes fail', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const real = globalThis.localStorage;
    const bad = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    Object.defineProperty(globalThis, 'localStorage', { value: bad, configurable: true });
    try {
      const st = useStore.getState();
      let siteId = '';
      let setId = '';
      expect(() => { siteId = st.addSite({ name: 'S', latDeg: 1, lonEastDeg: 2, elevM: 3 }); }).not.toThrow();
      expect(() => { setId = st.addSet({ name: 'A', observations: [] }); }).not.toThrow();
      expect(useStore.getState().sites.map((x) => x.id)).toEqual([siteId]);
      expect(useStore.getState().observationSets.map((x) => x.id)).toEqual([setId]);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true });
      warn.mockRestore();
    }
  });
});

describe('removeSite with referencing drafts', () => {
  it('converts draft siteKeys to stored: form and clears selection', () => {
    const st = useStore.getState();
    const id = st.addSite({ name: 'S', latDeg: 10.5, lonEastDeg: -20, elevM: 30 });
    const other = st.addSite({ name: 'O', latDeg: 0, lonEastDeg: 0, elevM: 0 });
    st.selectSite(id);
    const d = (k: string) => ({ utc: '', ra: '', dec: '', siteKey: k });
    const setId = st.addSet({ name: 'A', observations: [], drafts: [d(id), d('geocenter'), d(other)], checkDraft: d(id) });
    useStore.getState().removeSite(id);
    const s = useStore.getState();
    expect(s.selectedSiteId).toBeNull();
    const set = s.observationSets.find((x) => x.id === setId)!;
    expect(set.drafts!.map((x) => x.siteKey)).toEqual(['stored:10.5,-20,30', 'geocenter', other]);
    expect(set.checkDraft!.siteKey).toBe('stored:10.5,-20,30');
  });
});
