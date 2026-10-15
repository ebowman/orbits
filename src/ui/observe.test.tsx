// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { loadCatalog, predict } from '@astro';
import ObservePage, { jdToUtcInput, parseUtcInput } from './pages/ObservePage';
import { importSet, useStore } from './store';

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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup() {
  const id = useStore.getState().addSet({ name: 'T', observations: [] });
  useStore.getState().setActiveSet(id);
  mount();
  return id;
}
function mount() {
  render(
    <MemoryRouter>
      <ObservePage />
    </MemoryRouter>,
  );
}
const remount = () => {
  cleanup();
  mount();
};
const field = (n: number, label: string) =>
  within(screen.getByRole('group', { name: `Observation ${n}` })).getByLabelText(label) as HTMLInputElement;
const obsOf = (id: string) => useStore.getState().observationSets.find((s) => s.id === id)!.observations;
const fill = (n: number, dt: string, ra: string, dec: string) => {
  const fs = screen.getByRole('group', { name: `Observation ${n}` });
  fireEvent.change(within(fs).getByLabelText('Date/time (UTC)'), { target: { value: dt } });
  fireEvent.change(within(fs).getByLabelText(`RA ${n}`), { target: { value: ra } });
  fireEvent.change(within(fs).getByLabelText(`Dec ${n}`), { target: { value: dec } });
};
const solve = () => screen.getByRole('button', { name: 'Solve this set' }) as HTMLButtonElement;

describe('ObservePage', () => {
  it('persists valid entries and enables Solve', () => {
    const id = setup();
    expect(solve().disabled).toBe(true);
    fill(1, '2026-01-01T00:00', '12 34 56', '+10 00 00');
    fill(2, '2026-01-08T00:00', '12 40 00', '+10 30 00');
    fill(3, '2026-01-15T00:00', '12 50 00', '+11 00 00');
    const obs = useStore.getState().observationSets.find((s) => s.id === id)!.observations;
    expect(obs).toHaveLength(3);
    expect(obs[0]!.jdUtc).toBe(2461041.5);
    expect(obs[0]!.site).toBeNull();
    expect(screen.getByTestId('ra-echo-1').textContent).toContain('12 34 56.00');
    expect(solve().disabled).toBe(false);
    expect(JSON.parse(localStorage.getItem('orbits-v1')!).state.observationSets[0].observations).toHaveLength(3);
  });

  it('shows RA error and does not store the row', () => {
    const id = setup();
    fill(1, '2026-01-01T00:00', '25 00 00', '+10 00 00');
    expect(screen.getByRole('alert').textContent).toMatch(/< 24/);
    expect(useStore.getState().observationSets.find((s) => s.id === id)!.observations).toHaveLength(0);
  });

  it('shows Dec error', () => {
    setup();
    fill(1, '2026-01-01T00:00', '10 00 00', '95 00 00');
    expect(screen.getByRole('alert').textContent).toMatch(/Dec/);
  });

  it('non-increasing times block Solve', () => {
    setup();
    fill(1, '2026-01-08T00:00', '12 34 56', '+10 00 00');
    fill(2, '2026-01-01T00:00', '12 40 00', '+10 30 00');
    fill(3, '2026-01-15T00:00', '12 50 00', '+11 00 00');
    expect(screen.getByTestId('set-error').textContent).toMatch(/strictly increasing/);
    expect(solve().disabled).toBe(true);
  });

  it('treats datetime-local as UTC', () => {
    expect(parseUtcInput('2026-01-01T00:00:00')).toBe(2461041.5);
    expect(() => parseUtcInput('nope')).toThrow();
  });

  it('shows geolocation denied message', () => {
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: (_ok: unknown, bad: (e: { code: number; message: string }) => void) => bad({ code: 1, message: 'denied' }) },
    });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(screen.getByRole('status').textContent).toMatch(/denied/i);
  });

  it('shows message when geolocation is missing', () => {
    vi.stubGlobal('navigator', {});
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(screen.getByRole('status').textContent).toMatch(/not available/i);
  });

  it('adds a site with normalised longitude', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Site name'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('Latitude (deg)'), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText('Longitude east (deg)'), { target: { value: '270' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add site' }));
    expect(useStore.getState().sites[0]).toMatchObject({ name: 'X', latDeg: 40, lonEastDeg: -90, elevM: 0 });
  });

  it('delete needs in-page confirmation', () => {
    const id = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete set' }));
    expect(useStore.getState().observationSets).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(useStore.getState().observationSets.find((s) => s.id === id)).toBeUndefined();
  });

  describe('draft persistence', () => {
    it('invalid middle row survives remount; observations stay empty', () => {
      const id = setup();
      fill(1, '2026-01-01T00:00', '12 34 56', '+10 00 00');
      fill(2, '2026-01-08T00:00', '12 40 00', '95 00 00');
      fill(3, '2026-01-15T00:00', '12 50 00', '+11 00 00');
      expect(obsOf(id)).toEqual([]);
      remount();
      expect(field(2, 'Dec 2').value).toBe('95 00 00');
      expect(within(screen.getByRole('group', { name: 'Observation 2' })).getByRole('alert')).toBeTruthy();
      expect(field(3, 'RA 3').value).toBe('12 50 00');
      expect(field(3, 'Date/time (UTC)').value).toBe('2026-01-15T00:00');
      expect(field(1, 'RA 1').value).toBe('12 34 56');
      expect(obsOf(id)).toEqual([]);
    });

    it('clearing a field empties observations, keeps text; restoring brings back 3 in order', () => {
      const id = setup();
      fill(1, '2026-01-01T00:00', '12 34 56', '+10 00 00');
      fill(2, '2026-01-08T00:00', '12 40 00', '+10 30 00');
      fill(3, '2026-01-15T00:00', '12 50 00', '+11 00 00');
      expect(obsOf(id)).toHaveLength(3);
      fireEvent.change(field(2, 'RA 2'), { target: { value: '' } });
      expect(obsOf(id)).toEqual([]);
      remount();
      expect(field(2, 'Dec 2').value).toBe('+10 30 00');
      expect(field(2, 'RA 2').value).toBe('');
      expect(field(1, 'RA 1').value).toBe('12 34 56');
      fireEvent.change(field(2, 'RA 2'), { target: { value: '12 40 00' } });
      const o = obsOf(id);
      expect(o).toHaveLength(3);
      expect(o.map((x) => x.jdUtc)).toEqual([2461041.5, 2461048.5, 2461055.5]);
      expect(o.map((x) => x.label)).toEqual(['Obs 1', 'Obs 2', 'Obs 3']);
    });

    it('synthetic set remounts into the right slots', () => {
      setup();
      fireEvent.click(screen.getByRole('button', { name: 'Generate synthetic set' }));
      const st = useStore.getState();
      const set = st.observationSets.find((s) => s.id === st.activeSetId)!;
      remount();
      [0, 1, 2].forEach((k) => {
        expect(field(k + 1, 'Date/time (UTC)').value).toBe(
          ['2026-01-01T00:00', '2026-01-08T00:00', '2026-01-15T00:00'][k],
        );
        expect(field(k + 1, `RA ${k + 1}`).value).not.toBe('');
      });
      expect(set.observations).toHaveLength(3);
    });
  });

  it('preserves sub-second time precision', () => {
    const jd = parseUtcInput('2026-01-01T03:04:05.250');
    const whole = parseUtcInput('2026-01-01T03:04:05');
    expect(Math.abs(jd - (whole + 0.25 / 86400))).toBeLessThan(1e-8);
    expect(jdToUtcInput(jd)).toBe('2026-01-01T03:04:05.250');
    expect(jdToUtcInput(whole)).toBe('2026-01-01T03:04:05');
    expect(Math.abs(parseUtcInput(jdToUtcInput(jd)) - jd)).toBeLessThan(1e-8);
    for (const t of ['2026-01-01T03:04:05.001', '2026-01-01T23:59:59.999', '2026-03-05T00:00:00.5']) {
      expect(Math.abs(parseUtcInput(jdToUtcInput(parseUtcInput(t))) - parseUtcInput(t))).toBeLessThan(1e-8);
    }
    expect(() => parseUtcInput('2026-01-01T03:04:60.5')).toThrow();
  });

  it('observations stay valid after their site is removed', () => {
    const sid = useStore.getState().addSite({ name: 'Home', latDeg: 52.5, lonEastDeg: -6.25, elevM: 40 });
    const id = setup();
    const rows = [
      ['2026-01-01T00:00:00.250', '12 34 56', '+10 00 00'],
      ['2026-01-08T00:00', '12 40 00', '+10 30 00'],
      ['2026-01-15T00:00', '12 50 00', '+11 00 00'],
    ] as const;
    rows.forEach((r, i) => {
      fill(i + 1, r[0], r[1], r[2]);
      fireEvent.change(field(i + 1, 'Site ' + (i + 1)), { target: { value: sid } });
    });
    expect(obsOf(id)).toHaveLength(3);
    useStore.getState().removeSite(sid);
    remount();
    expect(field(1, 'Site 1').value).toBe('stored:52.5,-6.25,40');
    const o = obsOf(id);
    expect(o).toHaveLength(3);
    expect(o[0]!.site).toEqual({ latDeg: 52.5, lonEastDeg: -6.25, elevM: 40 });
    fill(1, rows[0][0], rows[0][1], rows[0][2]);
    expect(obsOf(id)).toHaveLength(3);
    expect(obsOf(id)[0]!.site).toEqual({ latDeg: 52.5, lonEastDeg: -6.25, elevM: 40 });
    expect(solve().disabled).toBe(false);
  });

  it('rejects impossible dates, accepts leap day', () => {
    expect(() => parseUtcInput('2026-02-31T00:00:00')).toThrow();
    expect(() => parseUtcInput('2025-02-29T00:00:00')).toThrow();
    expect(() => parseUtcInput('2026-04-31T00:00:00')).toThrow();
    expect(parseUtcInput('2024-02-29T00:00:00')).toBe(2460369.5);
  });

  it('import rejects malformed drafts and accepts missing/valid ones', () => {
    const d = { utc: 'a', ra: 'b', dec: 'c', siteKey: 'geocenter' };
    const mk = (drafts?: unknown) => JSON.stringify({ schemaVersion: 1, set: { name: 'n', observations: [], drafts } });
    expect(() => importSet(mk([d, d]))).toThrow(/drafts/);
    expect(() => importSet(mk([d, d, { ...d, ra: 5 }]))).toThrow(/drafts/);
    expect(() => importSet(mk('x'))).toThrow(/drafts/);
    expect(importSet(mk([d, d, d]))).toBeTruthy();
    expect(importSet(mk())).toBeTruthy();
  });

  describe('check observation', () => {
    const checkSet = (id: string) => useStore.getState().observationSets.find((s) => s.id === id)!;
    const toggle = () => fireEvent.click(screen.getByLabelText('Add a 4th check observation (optional)'));
    const fillCheck = (dt: string, ra: string, dec: string) => {
      const fs = screen.getByRole('group', { name: 'Check observation' });
      fireEvent.change(within(fs).getByLabelText('Date/time (UTC)'), { target: { value: dt } });
      fireEvent.change(within(fs).getByLabelText('RA check'), { target: { value: ra } });
      fireEvent.change(within(fs).getByLabelText('Dec check'), { target: { value: dec } });
    };
    const fill3 = () => {
      fill(1, '2026-01-01T00:00', '12 34 56', '+10 00 00');
      fill(2, '2026-01-08T00:00', '12 40 00', '+10 30 00');
      fill(3, '2026-01-15T00:00', '12 50 00', '+11 00 00');
    };

    it('valid check row sets check; invalid or cleared leaves it undefined; IOD stays 3', () => {
      const id = setup();
      fill3();
      toggle();
      expect(checkSet(id).check).toBeUndefined();
      fillCheck('2026-01-22T00:00', '13 00 00', '+11 30 00');
      expect(checkSet(id).check?.jdUtc).toBe(2461062.5);
      expect(checkSet(id).observations).toHaveLength(3);
      expect(checkSet(id).checkDraft?.ra).toBe('13 00 00');
      fillCheck('2026-01-22T00:00', '25 00 00', '+11 30 00');
      expect(checkSet(id).check).toBeUndefined();
      fillCheck('2026-01-22T00:00', '13 00 00', '+11 30 00');
      expect(checkSet(id).check).toBeDefined();
      toggle();
      expect(checkSet(id).check).toBeUndefined();
      expect(checkSet(id).checkDraft).toBeUndefined();
    });

    it('check time before t1 is allowed; time within 1 s of an IOD time is rejected', () => {
      const id = setup();
      fill3();
      toggle();
      fillCheck('2025-12-25T00:00', '13 00 00', '+11 30 00');
      expect(checkSet(id).check).toBeDefined();
      fillCheck('2026-01-08T00:00:00', '13 00 00', '+11 30 00');
      expect(checkSet(id).check).toBeUndefined();
      expect(screen.getByTestId('check-error').textContent).toMatch(/differ/);
    });

    it('importSet round-trips check/checkDraft and legacy sets without them load', () => {
      const check = { jdUtc: 2461062.5, raRad: 1, decRad: 0.2, site: null, label: 'Check obs' };
      const cd = { utc: 'a', ra: 'b', dec: 'c', siteKey: 'geocenter' };
      const mk = (extra: object) => JSON.stringify({ schemaVersion: 1, set: { name: 'n', observations: [], ...extra } });
      const id = importSet(mk({ check, checkDraft: cd }));
      const s = useStore.getState().observationSets.find((x) => x.id === id)!;
      expect(s.check).toEqual(check);
      expect(s.checkDraft).toEqual(cd);
      expect(() => importSet(mk({ checkDraft: { utc: 1 } }))).toThrow(/checkDraft/);
      expect(() => importSet(mk({ check: { jdUtc: 1 } }))).toThrow(/check observation/);
      const legacyId = importSet(mk({}));
      const legacy = useStore.getState().observationSets.find((x) => x.id === legacyId)!;
      expect(legacy.check).toBeUndefined();
      expect(legacy.checkDraft).toBeUndefined();
      // legacy set in the store still renders without a check row
      useStore.getState().setActiveSet(legacy.id);
      mount();
      expect(screen.queryByRole('group', { name: 'Check observation' })).toBeNull();
    });

    it('synthetic 4 option yields 3 observations + check at t3 + (t3 - t2)', () => {
      setup();
      fireEvent.change(screen.getByLabelText('Body'), { target: { value: loadCatalog().find((c) => c.name === 'Ceres')!.id } });
      fireEvent.change(screen.getByLabelText('Observations'), { target: { value: '4' } });
      fireEvent.click(screen.getByRole('button', { name: 'Generate synthetic set' }));
      const st = useStore.getState();
      const set = st.observationSets.find((x) => x.id === st.activeSetId)!;
      expect(set.observations).toHaveLength(3);
      const [, t2, t3] = set.observations.map((o) => o.jdUtc) as [number, number, number];
      expect(set.check!.jdUtc).toBeCloseTo(t3 + (t3 - t2), 9);
      expect(set.check!.label).toBe('Synthetic check');
      expect(screen.getByRole('group', { name: 'Check observation' })).toBeTruthy();
      // default stays 3
      cleanup();
      mount();
      fireEvent.click(screen.getByRole('button', { name: 'Generate synthetic set' }));
      const st2 = useStore.getState();
      expect(st2.observationSets.find((x) => x.id === st2.activeSetId)!.check).toBeUndefined();
    });
  });

  describe('synthetic', () => {
    const gen = (sigma: string, seed = '1') => {
      fireEvent.change(screen.getByLabelText('Noise sigma (arcsec)'), { target: { value: sigma } });
      fireEvent.change(screen.getByLabelText('Seed'), { target: { value: seed } });
      fireEvent.click(screen.getByRole('button', { name: 'Generate synthetic set' }));
      const st = useStore.getState();
      return st.observationSets.find((s) => s.id === st.activeSetId)!;
    };
    const ceres = () => loadCatalog().find((c) => c.name === 'Ceres')!;

    it('Ceres at noise 0 matches predict exactly', () => {
      setup();
      fireEvent.change(screen.getByLabelText('Body'), { target: { value: ceres().id } });
      const set = gen('0');
      expect(set.synthetic).toBe(true);
      expect(set.targetId).toBe(ceres().id);
      expect(set.name).toBe('Ceres synthetic 2026-01-01');
      expect(set.observations).toHaveLength(3);
      set.observations.forEach((o, k) => {
        const p = predict(ceres().body, 2461041.5 + 7 * k, null);
        expect(o.raRad).toBe(p.raRad);
        expect(o.decRad).toBe(p.decRad);
        expect(o.jdUtc).toBe(2461041.5 + 7 * k);
      });
      expect(screen.getByLabelText('RA 1')).toBeTruthy();
    });

    it('noise is deterministic for a fixed seed', () => {
      setup();
      fireEvent.change(screen.getByLabelText('Body'), { target: { value: ceres().id } });
      const a = gen('5', '7');
      const b = gen('5', '7');
      const c = gen('5', '8');
      const z = gen('0', '7');
      expect(b.observations).toEqual(a.observations);
      expect(c.observations).not.toEqual(a.observations);
      expect(a.observations[0]!.raRad).not.toBe(z.observations[0]!.raRad);
    });
  });
});
