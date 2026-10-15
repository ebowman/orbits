// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { loadCatalog, predict, type IODInput, type OrbitalElements } from '@astro';
import LearnGaussPage from './pages/LearnGaussPage';
import MathText, { splitMath } from './learn/Math';
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

vi.mock('./scene/OrbitScene', () => ({
  default: (p: { orbits?: unknown[]; points?: unknown[]; rays?: unknown[] }) => (
    <div
      data-testid="scene"
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

describe('LearnGaussPage', () => {
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
