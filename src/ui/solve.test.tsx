// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { loadCatalog, predict, type IODInput, type OrbitalElements } from '@astro';
import * as astro from '@astro';
import SolvePage from './pages/SolvePage';
import { lsqDisagrees } from './solve/compute';
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

vi.mock('@astro', async (orig) => {
  const mod = await orig<typeof import('@astro')>();
  return { ...mod, gauss: vi.fn(mod.gauss), differentialCorrection: vi.fn(mod.differentialCorrection) };
});

const initial = useStore.getState();
beforeEach(() => {
  localStorage.clear();
  useStore.setState({ ...initial, sites: [], observationSets: [], selectedSiteId: null, activeSetId: null });
});
afterEach(() => {
  cleanup();
  vi.mocked(astro.gauss).mockClear();
  vi.mocked(astro.differentialCorrection).mockReset();
});

const body = (id: string) => loadCatalog().find((c) => c.id === id)!.body as OrbitalElements;
function synth(id: string, start: number): IODInput {
  const el = body(id);
  return [0, 10, 20].map((d) => {
    const p = predict(el, start + d, null);
    return { jdUtc: start + d, raRad: p.raRad, decRad: p.decRad, site: null };
  }) as IODInput;
}
function mount(observations: IODInput | [], targetId?: string) {
  const id = useStore.getState().addSet({ name: 'S', observations, ...(targetId ? { targetId } : {}) });
  useStore.getState().setActiveSet(id);
  render(
    <MemoryRouter>
      <SolvePage />
    </MemoryRouter>,
  );
}
const num = (testId: string) => parseFloat(screen.getByTestId(testId).textContent!.replace(/[^0-9eE+.-]/g, ''));

describe('SolvePage', () => {
  it('noiseless Ceres: Gauss a error is tiny', () => {
    mount(synth('1', 2461410.5), '1');
    expect(num('pct-gauss-a')).toBeLessThan(1e-4);
    expect(screen.queryByTestId('ambiguous-banner')).toBeNull();
    expect(screen.getByText(/no perturbations/)).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Residuals' })).toBeTruthy();
    expect(screen.getByTestId('fwd-gauss-7').textContent).toContain('arcmin');
  });

  it('no target: no error cells', () => {
    mount(synth('1', 2461410.5));
    expect(screen.queryByTestId('pct-gauss-a')).toBeNull();
    expect(screen.getByTestId('cell-gauss-a').textContent).toMatch(/\d/);
  });

  it('incomplete set shows only the message and link', () => {
    mount([]);
    expect(screen.getByTestId('incomplete').textContent).toContain('Incomplete set — enter 3 valid observations on the Observe page');
    expect(screen.getByRole('link', { name: 'Observe page' })).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Elements' })).toBeNull();
  });

  it('a Gauss failure shows in its column while Laplace columns render', () => {
    vi.mocked(astro.gauss).mockImplementationOnce(() => {
      throw new Error('boom from gauss');
    });
    mount(synth('1', 2461410.5), '1');
    expect(within(screen.getByTestId('cell-gauss-a')).getByRole('alert').textContent).toBe('boom from gauss');
    expect(screen.getByTestId('cell-laplaceRefined-a').textContent).toMatch(/\d\.\d/);
    expect(screen.getByTestId('cell-laplaceClassical-a').textContent).toMatch(/\d\.\d/);
  });

  it('multi-root Eros: banner, candidates, and use this root changes a', () => {
    mount(synth('433', 2460975.5 + 90), '433');
    expect(screen.getByTestId('ambiguous-banner').textContent).toContain('Ambiguous: 2 physically valid solutions');
    expect(screen.getByRole('table', { name: 'Candidate roots' })).toBeTruthy();
    const before = screen.getByTestId('cell-gauss-a').textContent;
    fireEvent.click(screen.getAllByRole('button', { name: 'use this root' })[0]!);
    expect(screen.getByTestId('cell-gauss-a').textContent).not.toBe(before);
    expect(num('pct-gauss-a')).toBeLessThan(1e-3);
  });

  describe('check observation', () => {
    function mountWithCheck(id: string, start: number, checkOffset: number, targetId: string) {
      const el = body(id);
      const p = predict(el, start + checkOffset, null);
      const check = { jdUtc: start + checkOffset, raRad: p.raRad, decRad: p.decRad, site: null, label: 'Synthetic check' };
      const sid = useStore.getState().addSet({ name: 'S', observations: synth(id, start), check, targetId });
      useStore.getState().setActiveSet(sid);
      render(
        <MemoryRouter>
          <SolvePage />
        </MemoryRouter>,
      );
    }

    it('Eros ambiguous date: 4th obs auto-selects the correct root and banner says resolved', () => {
      mountWithCheck('433', 2460975.5 + 90, 30, '433');
      expect(screen.queryByTestId('ambiguous-banner')).toBeNull();
      expect(screen.getByTestId('resolved-banner').textContent).toContain('Resolved by 4th observation');
      expect(num('pct-gauss-a')).toBeLessThan(1);
      expect(screen.getByRole('table', { name: 'Candidate roots' })).toBeTruthy();
      expect(screen.getByText('Check obs residual', { selector: 'th' })).toBeTruthy();
    });

    it('check residual cell renders small (< 60 arcsec) for a noise-free synthetic set', () => {
      mountWithCheck('1', 2461410.5, 30, '1');
      const txt = screen.getByTestId('check-resid-gauss').textContent!;
      expect(txt).toMatch(/″$/);
      expect(parseFloat(txt)).toBeLessThan(60);
    });

    it('LSQ column labels the check residual as in fit (not validation)', () => {
      mountWithCheck('1', 2461410.5, 30, '1');
      const cell = screen.getByTestId('check-resid-lsq');
      expect(cell.textContent).toContain('(in fit)');
      expect(cell.getAttribute('title')).toMatch(/not an independent validation/);
    });

    // Fake the LSQ RMS per run (in survivor order) to exercise the tie rule regardless of which root the check favours.
    function lsqWithRms(rms: number[]) {
      let call = 0;
      const real = vi.mocked(astro.differentialCorrection).getMockImplementation()!;
      vi.mocked(astro.differentialCorrection).mockImplementation((o, i, opts) => {
        const fit = real(o, i, opts);
        return { ...fit, converged: true, rmsArcsec: rms[call++ % rms.length]! };
      });
    }

    it('LSQ RMS tie (within 1%) shows no disagreement banner, in either run order', () => {
      for (const order of [[0.5, 0.503], [0.503, 0.5]]) {
        lsqWithRms(order);
        mountWithCheck('433', 2460975.5 + 90, 30, '433');
        expect(screen.queryByTestId('lsq-disagreement')).toBeNull();
        cleanup();
      }
    });

    it('clearly different LSQ RMS across roots shows the disagreement banner for one run order', () => {
      let shown = 0;
      for (const order of [[0.5, 5], [5, 0.5]]) {
        lsqWithRms(order);
        mountWithCheck('433', 2460975.5 + 90, 30, '433');
        if (screen.queryByTestId('lsq-disagreement')) shown++;
        cleanup();
      }
      expect(shown).toBe(1);
    });

    it('without a check obs the ambiguous banner carries the hint', () => {
      mount(synth('433', 2460975.5 + 90), '433');
      expect(screen.getByTestId('ambiguous-banner').textContent).toContain('Add a 4th check observation on Observe to resolve this.');
    });
  });
});

describe('lsqDisagrees absolute tie branch', () => {
  const run = (rootIndex: number, rms: number) =>
    ({ rootIndex, r2: 1, selected: false, fit: { rmsArcsec: rms, converged: true } as never, error: null });
  it('treats RMS within 1e-3 arcsec as a tie even when the relative gap exceeds 1%', () => {
    const runs = [run(0, 0.0005), run(1, 0.0013)];
    expect(lsqDisagrees(runs, { rootIndex: 0 }, runs[1]!)).toBe(false);
  });
  it('reports disagreement when both the absolute and relative gaps are large', () => {
    const runs = [run(0, 0.5), run(1, 0.9)];
    expect(lsqDisagrees(runs, { rootIndex: 0 }, runs[1]!)).toBe(true);
  });
});
