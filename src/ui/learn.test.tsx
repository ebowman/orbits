// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { gauss, laplace, loadCatalog, predict, type IODInput, type OrbitalElements } from '@astro';
import LearnGaussPage from './pages/LearnGaussPage';
import LearnLaplacePage, { SkyInset } from './pages/LearnLaplacePage';
import MathText, { splitMath } from './learn/Math';
import { useStore } from './store';
import { ceresExample } from './learn/source';

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

vi.mock('./scene/OrbitScene', () => ({
  default: (p: { orbits?: { label?: string; elements: { epochJd: number } }[]; points?: unknown[]; rays?: unknown[] }) => (
    <div
      data-testid="scene"
      data-epochs={JSON.stringify(Object.fromEntries((p.orbits ?? []).map((o) => [o.label, o.elements.epochJd])))}
      data-orbits={p.orbits?.length ?? 0}
      data-points={p.points?.length ?? 0}
      data-rays={p.rays?.length ?? 0}
    />
  ),
}));

const initial = useStore.getState();
beforeEach(() => {
  localStorage.clear();
  useStore.setState({ ...initial, sites: [], observationSets: [], selectedSiteId: null, activeSetId: null });
  HTMLCanvasElement.prototype.getContext = (() => ({})) as unknown as HTMLCanvasElement['getContext'];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const title = () => screen.getByTestId('step-title').textContent;
const counter = () => screen.getByTestId('step-counter').textContent!;
const total = () => Number(/of (\d+)/.exec(counter())![1]);

/** Steps the page through its iteration-N steps; returns, per step, the scene's {label: epochJd} map and the trace step. */
function iterationEpochs(trace: { id: string; values: Record<string, unknown> }[]) {
  const out: { id: string; jd: number; epochs: Record<string, number> }[] = [];
  trace.forEach((st, k) => {
    if (!st.id.startsWith('iteration-')) return;
    fireEvent.change(screen.getByLabelText('Step'), { target: { value: String(k) } });
    out.push({ id: st.id, jd: st.values.jdTt2 as number, epochs: JSON.parse(screen.getByTestId('scene').getAttribute('data-epochs')!) });
  });
  return out;
}

describe('LearnGaussPage', () => {
  it('passes each iteration its own jdTt2 as the scene epoch (not a fixed epoch)', async () => {
    const trace = gauss(ceresExample()).trace;
    render(<LearnGaussPage />);
    await screen.findByTestId('scene');
    const its = iterationEpochs(trace);
    expect(its.length).toBeGreaterThanOrEqual(2);
    // Light-time correction makes the epoch differ between iterations (iteration 1 uses the uncorrected epoch).
    expect(new Set(its.map((x) => x.jd)).size).toBeGreaterThanOrEqual(2);
    for (const it of its) expect(it.epochs[`iteration ${it.id.slice('iteration-'.length)}`]).toBe(it.jd);
    // Older iterations drawn alongside also keep their own epoch.
    for (const it of its) for (const [label, jd] of Object.entries(it.epochs)) expect(jd).toBe(its.find((x) => `iteration ${x.id.slice(10)}` === label)!.jd);
    expect(new Set(its.flatMap((x) => Object.values(x.epochs))).size).toBeGreaterThanOrEqual(2);
  });

  it('uses the built-in Ceres example when the store is empty and Next/Prev change the title', async () => {
    render(<LearnGaussPage />);
    expect(screen.getByTestId('data-source').textContent).toMatch(/built-in synthetic Ceres/);
    await screen.findByTestId('scene');
    const t0 = title();
    fireEvent.click(screen.getByText('Next'));
    const t1 = title();
    expect(t1).not.toBe(t0);
    fireEvent.click(screen.getByText('Prev'));
    expect(title()).toBe(t0);
    expect((screen.getByText('Prev') as HTMLButtonElement).disabled).toBe(true);
  });

  it('slider jumps to a step and the last step shows element values', () => {
    render(<LearnGaussPage />);
    const n = total();
    fireEvent.change(screen.getByLabelText('Step'), { target: { value: String(n - 1) } });
    expect(title()).toBe('Orbital elements');
    for (const k of ['a', 'e', 'i', 'Omega', 'omega', 'M0']) expect(screen.getByTestId(`value-${k}`)).toBeTruthy();
    expect(Number(screen.getByTestId('value-a').textContent)).toBeCloseTo(2.77, 0);
    expect((screen.getByText('Next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('steps through every step without errors, with overlays and a roots plot', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<LearnGaussPage />);
    await screen.findByTestId('scene');
    const n = total();
    const seen = new Set<string>();
    let plot = false;
    for (let k = 0; k < n; k++) {
      seen.add(title()!);
      expect(screen.getByTestId('step-explanation').textContent!.length).toBeGreaterThan(10);
      if (screen.queryByTestId('roots-plot')) {
        plot = true;
        expect(screen.getAllByTestId('root-chosen')).toHaveLength(1);
      }
      if (k < n - 1) fireEvent.click(screen.getByText('Next'));
    }
    expect(seen.size).toBe(n);
    expect(plot).toBe(true);
    expect(err).not.toHaveBeenCalled();
  });

  it('scene overlays follow the step', async () => {
    render(<LearnGaussPage />);
    const scene = await screen.findByTestId('scene');
    expect(scene.getAttribute('data-rays')).toBe('3'); // los-vectors
    fireEvent.change(screen.getByLabelText('Step'), { target: { value: String(total() - 1) } });
    expect(screen.getByTestId('scene').getAttribute('data-orbits')).toBe('2'); // solved + catalog
  });

  it('uses the active store set when complete, with a selector back to the example', () => {
    const el = loadCatalog().find((c) => c.id === '1')!.body as OrbitalElements;
    const start = el.epochJd + 120;
    const obs = [0, 10, 20].map((d) => {
      const p = predict(el, start + d, null);
      return { jdUtc: start + d, raRad: p.raRad, decRad: p.decRad, site: null };
    }) as IODInput;
    const id = useStore.getState().addSet({ name: 'Mine', observations: obs, targetId: '1' });
    useStore.getState().setActiveSet(id);
    render(<LearnGaussPage />);
    expect(screen.getByTestId('data-source').textContent).toMatch(/Mine/);
    fireEvent.change(screen.getByLabelText('Data source'), { target: { value: 'example' } });
    expect(screen.getByTestId('data-source').textContent).toMatch(/built-in synthetic Ceres/);
  });

  it('falls back to the example when the active set is incomplete', () => {
    const id = useStore.getState().addSet({ name: 'Partial', observations: [] });
    useStore.getState().setActiveSet(id);
    render(<LearnGaussPage />);
    expect(screen.getByTestId('data-source').textContent).toMatch(/built-in synthetic Ceres/);
  });

  it('intro is at most 200 words', () => {
    render(<LearnGaussPage />);
    const words = screen.getByTestId('gauss-intro').textContent!.split(/\s+/).filter(Boolean).length;
    expect(words).toBeLessThanOrEqual(200);
  });
});

describe('MathText', () => {
  it('splits math and renders KaTeX; non-math is escaped text', () => {
    expect(splitMath('a $x$ b $$y$$ c').map((s) => s.kind)).toEqual(['text', 'math', 'text', 'math', 'text']);
    const { container } = render(<MathText text={'<img src=x onerror=alert(1)> and $x^2$'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.textContent).toContain('<img');
  });
});

describe('LearnLaplacePage', () => {
  it('passes each iteration its own jdTt2 as the scene epoch (not a fixed epoch)', async () => {
    const trace = laplace(ceresExample(), { iterate: true }).trace;
    render(<LearnLaplacePage />);
    await screen.findByTestId('scene');
    const its = iterationEpochs(trace);
    expect(its.length).toBeGreaterThanOrEqual(2);
    expect(new Set(its.map((x) => x.jd)).size).toBeGreaterThanOrEqual(2);
    for (const it of its) expect(it.epochs[it.id]).toBe(it.jd);
  });

  const goto = (name: string) => {
    const n = total();
    for (let k = 0; k < n; k++) {
      if (title() === name) return;
      fireEvent.click(screen.getByText('Next'));
    }
    throw new Error(`step ${name} not found`);
  };

  it('uses the built-in example and Next/Prev change the step', async () => {
    render(<LearnLaplacePage />);
    expect(screen.getByTestId('data-source').textContent).toMatch(/built-in synthetic Ceres/);
    await screen.findByTestId('scene');
    const t0 = title();
    fireEvent.click(screen.getByText('Next'));
    expect(title()).not.toBe(t0);
    fireEvent.click(screen.getByText('Prev'));
    expect(title()).toBe(t0);
    expect((screen.getByText('Prev') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows L-prime and L-double-prime arrows plus the curve on the derivatives step', () => {
    render(<LearnLaplacePage />);
    goto('Line-of-sight derivatives');
    const svg = screen.getByTestId('sky-inset');
    expect(svg.querySelector('[data-testid="arrow-Lp"] line')).not.toBeNull();
    expect(svg.querySelector('[data-testid="arrow-Lpp"] line')).not.toBeNull();
    expect(svg.querySelector('[data-testid="sky-curve"]')).not.toBeNull();
    expect(svg.querySelectorAll('[data-testid="sky-point"]')).toHaveLength(3);
    expect(screen.getByTestId('sky-scale').textContent).toMatch(/deg on sky/);
  });

  it('draws no L-prime / L-double-prime arrows on the interpolation step', () => {
    render(<LearnLaplacePage />);
    goto('Interpolating the line of sight');
    const svg = screen.getByTestId('sky-inset');
    expect(svg.querySelector('[data-testid="arrow-Lp"]')).toBeNull();
    expect(svg.querySelector('[data-testid="arrow-Lpp"]')).toBeNull();
    expect(svg.querySelector('[data-testid="sky-curve"]')).not.toBeNull();
  });

  it('steps through every step without console errors and shows the classical vs refined table', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<LearnLaplacePage />);
    await screen.findByTestId('scene');
    const n = total();
    const seen = new Set<string>();
    let tables = 0;
    for (let k = 0; k < n; k++) {
      seen.add(title()!);
      if (screen.queryByTestId('compare-table')) {
        tables++;
        for (const e of ['a', 'e', 'i', 'Omega', 'omega', 'M0']) expect(screen.getByTestId(`cmp-diff-${e}`).textContent).toMatch(/e[+-]\d+/);
      }
      if (k < n - 1) fireEvent.click(screen.getByText('Next'));
    }
    expect(seen.size).toBe(n);
    expect(tables).toBeGreaterThanOrEqual(2); // classical-result and elements
    expect(err).not.toHaveBeenCalled();
  });

  it('final overlay shows classical, refined and catalog orbits', async () => {
    render(<LearnLaplacePage />);
    await screen.findByTestId('scene');
    fireEvent.change(screen.getByLabelText('Step'), { target: { value: String(total() - 1) } });
    expect(screen.getByTestId('scene').getAttribute('data-orbits')).toBe('3');
  });

  it('intro is at most 200 words', () => {
    render(<LearnLaplacePage />);
    expect(screen.getByTestId('laplace-intro').textContent!.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(200);
  });
});

describe('SkyInset', () => {
  it('unwraps RA across the atan2 branch cut (180 deg) so adjacent points stay close', () => {
    const v = (raDeg: number): [number, number, number] => {
      const a = (raDeg * Math.PI) / 180;
      return [Math.cos(a), Math.sin(a), 0];
    };
    // 179, 180.5, 182 deg: atan2 returns +179, -179.5, -178, so the raw RA differences are ~358 deg without wrapPi.
    const { container } = render(
      <SkyInset L={[v(179), v(180.5), v(182)]} tau1={-10} tau3={10} Lp={[0, 0.01, 0]} Lpp={[0, 0, 0.001]} />,
    );
    const cxs = [...container.querySelectorAll('[data-testid="sky-point"] circle')].map((c) => Number(c.getAttribute('cx')));
    expect(cxs).toHaveLength(3);
    const d12 = Math.abs(cxs[0]! - cxs[1]!);
    const d23 = Math.abs(cxs[1]! - cxs[2]!);
    expect(d12).toBeGreaterThan(0);
    expect(d12 / d23).toBeGreaterThan(0.5); // 1.5 deg vs 1.5 deg apart
    expect(d12 / d23).toBeLessThan(2);
    const d = container.querySelector('[data-testid="sky-curve"]')!.getAttribute('d')!;
    const xs = [...d.matchAll(/[ML]([\d.-]+),/g)].map((m) => Number(m[1]));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(400);
  });
});
