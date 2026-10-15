import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gauss } from './iod/gauss';
import { loadCatalog } from './catalog';
import type { OrbitalElements } from './elements';
import { bestElongationStart, defaultSolvers, median, sweep, sweepCell, type SweepParams } from './sensitivity';

// Spy on the real gauss module so EVERY path (iterated result, first approximation, any bypass) is counted.
vi.mock('./iod/gauss', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./iod/gauss')>();
  return { ...actual, gauss: vi.fn(actual.gauss) };
});

const ceres = loadCatalog().find((c) => c.id === '1')!.body as OrbitalElements;
const base = (): SweepParams => ({
  el: ceres,
  startJd: bestElongationStart(ceres),
  spacings: [10],
  noiseArcsec: [0, 2],
  trials: 3,
  seed: 5,
});

describe('sensitivity', () => {
  it('median handles empty/odd/even', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });

  it('is deterministic for a fixed seed and differs for another', () => {
    const a = sweep(base());
    const b = sweep(base());
    expect(b).toEqual(a);
    const c = sweep({ ...base(), seed: 6 });
    expect(c[0]![1]!.gaussAErrMedian).not.toBe(a[0]![1]!.gaussAErrMedian);
  });

  it('zero-noise Gauss median error is ~0', () => {
    const cell = sweep(base())[0]![0]!;
    expect(cell.gaussFailRate).toBe(0);
    expect(cell.gaussAErrMedian).not.toBeNull();
    expect(cell.gaussAErrMedian!).toBeLessThan(1e-6);
  });

  it('counts thrown solver errors as failures and excludes them from the median', () => {
    const boom = () => {
      throw new Error('nope');
    };
    const cell = sweepCell(base(), 0, 1, { ...defaultSolvers, laplace: boom });
    expect(cell.laplaceFailRate).toBe(1);
    expect(cell.laplaceAErrMedian).toBeNull();
    expect(cell.gaussFailRate).toBeLessThan(1);
  });

  it('counts non-elliptic results as failures', () => {
    const hyper = (obs: Parameters<typeof defaultSolvers.gauss>[0]) => {
      const r = defaultSolvers.gauss(obs);
      return { ...r, elements: { ...r.elements, e: 1.5 } };
    };
    const cell = sweepCell(base(), 0, 0, { ...defaultSolvers, gauss: hyper });
    expect(cell.gaussFailRate).toBe(1);
    expect(cell.gaussAErrMedian).toBeNull();
  });

  it('reports progress', () => {
    const calls: number[] = [];
    sweep({ ...base(), trials: 1 }, { onProgress: (d, t) => calls.push(d * 10 + t) });
    expect(calls).toEqual([12, 22]);
  });

  it('seeds each cell from its (spacing, noise) values, not grid position', () => {
    const p = base();
    const a = sweepCell({ ...p, spacings: [10], noiseArcsec: [0, 2] }, 0, 1);
    const b = sweepCell({ ...p, spacings: [5, 10, 20], noiseArcsec: [1, 3, 2] }, 1, 2);
    expect(b).toEqual(a);
  });

  describe('Gauss call count', () => {
    beforeEach(() => {
      vi.mocked(gauss).mockClear();
    });

    it('runs the real gauss exactly once per trial (first approximation reuses the same run)', () => {
      for (const [trials, noise] of [[3, 0], [4, 1]] as const) {
        vi.mocked(gauss).mockClear();
        const cell = sweepCell({ ...base(), trials, noiseArcsec: [noise] }, 0, 0);
        expect(vi.mocked(gauss)).toHaveBeenCalledTimes(trials);
        expect(cell.gaussFirstFailRate).toBeLessThan(1);
      }
    });

    it('counts gauss calls made through the default solvers across a whole sweep', () => {
      sweep({ ...base(), trials: 2 }); // 1 spacing x 2 noise x 2 trials
      expect(vi.mocked(gauss)).toHaveBeenCalledTimes(4);
    });
  });
});
