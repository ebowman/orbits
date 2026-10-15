import { useEffect, useMemo, useRef, useState } from 'react';
import { bestElongationStart, loadCatalog, sweepCell, type OrbitalElements, type SweepCell, type SweepParams } from '@astro';
import type { SweepMessage } from '../workers/sweep.worker';

const MAX_AXIS = 8;
const MAX_TRIALS = 50;
const FLOOR = 1e-8; // errors below this are drawn at the bottom of the colour scale

function parseList(text: string, label: string, min: number, strictlyPositive: boolean): number[] {
  const xs = text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  if (xs.length === 0) throw new Error(`${label}: enter at least one value.`);
  if (xs.length > MAX_AXIS) throw new Error(`${label}: at most ${MAX_AXIS} values.`);
  if (xs.some((x) => !Number.isFinite(x) || x < min || (strictlyPositive && x <= 0)))
    throw new Error(`${label}: values must be ${strictlyPositive ? 'positive' : 'non-negative'} numbers.`);
  return xs;
}

/** Runs a sweep: in a module Web Worker when available, otherwise in chunks on the main thread. */
function startSweep(
  params: SweepParams,
  onProgress: (done: number, total: number) => void,
  onDone: (grid: SweepCell[][]) => void,
  onError: (m: string) => void,
): () => void {
  if (typeof Worker !== 'undefined') {
    try {
      const w = new Worker(new URL('../workers/sweep.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<SweepMessage>) => {
        const m = e.data;
        if (m.type === 'progress') onProgress(m.done, m.total);
        else if (m.type === 'done') {
          onDone(m.grid);
          w.terminate();
        } else {
          onError(m.message);
          w.terminate();
        }
      };
      w.onerror = (e) => {
        onError(e.message || 'Worker failed.');
        w.terminate();
      };
      w.postMessage({ type: 'run', params });
      return () => w.terminate();
    } catch {
      /* fall through to the main-thread fallback */
    }
  }
  const nS = params.spacings.length;
  const nN = params.noiseArcsec.length;
  const grid: SweepCell[][] = params.spacings.map(() => []);
  let k = 0;
  let cancelled = false;
  const step = () => {
    if (cancelled) return;
    try {
      const i = Math.floor(k / nN);
      grid[i]!.push(sweepCell(params, i, k % nN));
      k++;
      onProgress(k, nS * nN);
      if (k < nS * nN) setTimeout(step, 0);
      else onDone(grid);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  setTimeout(step, 0);
  return () => {
    cancelled = true;
  };
}

type Pick = (c: SweepCell) => number | null;

function colorFor(v: number | null, lo: number, hi: number): string {
  if (v === null) return '#d8d8d8';
  const t = hi > lo ? (Math.log10(Math.max(v, FLOOR)) - lo) / (hi - lo) : 0;
  const u = Math.min(1, Math.max(0, t));
  // dark blue (small error) -> yellow -> red (large error)
  const hue = 240 - 240 * u;
  return `hsl(${hue.toFixed(0)}, 70%, ${(40 + 15 * Math.sin(Math.PI * u)).toFixed(0)}%)`;
}

const fmt = (v: number | null) => (v === null ? 'no data' : v < FLOOR ? `<${FLOOR.toExponential(0)}` : v.toExponential(1));

function Heatmap({ title, grid, pick, lo, hi }: { title: string; grid: SweepCell[][]; pick: Pick; lo: number; hi: number }) {
  const spacings = grid.map((r) => r[0]!.spacing);
  const noises = grid[0]!.map((c) => c.noise);
  const cw = 64;
  const ch = 34;
  const left = 70;
  const top = 26;
  const w = left + cw * noises.length + 10;
  const h = top + ch * spacings.length + 40;
  return (
    <figure>
      <figcaption>{title}</figcaption>
      <svg role="img" aria-label={title} data-testid="heatmap" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {noises.map((n, j) => (
          <text key={`n${j}`} x={left + cw * j + cw / 2} y={top - 8} fontSize="11" textAnchor="middle">
            {n}
          </text>
        ))}
        {spacings.map((s, i) => (
          <text key={`s${i}`} x={left - 6} y={top + ch * i + ch / 2 + 4} fontSize="11" textAnchor="end">
            {s}
          </text>
        ))}
        {grid.map((row, i) =>
          row.map((c, j) => {
            const v = pick(c);
            return (
              <g key={`${i}-${j}`} data-testid="heat-cell" data-nodata={v === null ? 'true' : 'false'}>
                <title>{`spacing ${c.spacing} d, noise ${c.noise}": median rel. a error ${fmt(v)}`}</title>
                <rect x={left + cw * j} y={top + ch * i} width={cw - 1} height={ch - 1} fill={colorFor(v, lo, hi)} />
                <text x={left + cw * j + cw / 2} y={top + ch * i + ch / 2 + 4} fontSize="10" textAnchor="middle" fill="#fff" stroke="#000" strokeWidth="0.3">
                  {v === null ? 'no data' : fmt(v)}
                </text>
              </g>
            );
          }),
        )}
        <text x={left + (cw * noises.length) / 2} y={h - 8} fontSize="12" textAnchor="middle">
          noise sigma (arcsec per coordinate)
        </text>
        <text x={12} y={top + (ch * spacings.length) / 2} fontSize="12" textAnchor="middle" transform={`rotate(-90 12 ${top + (ch * spacings.length) / 2})`}>
          spacing (days)
        </text>
      </svg>
    </figure>
  );
}

function Legend({ lo, hi }: { lo: number; hi: number }) {
  const ticks: number[] = [];
  for (let e = Math.ceil(lo); e <= Math.floor(hi); e++) ticks.push(e);
  const stops = Array.from({ length: 11 }, (_, k) => colorFor(10 ** (lo + ((hi - lo) * k) / 10), lo, hi));
  const W = 260;
  return (
    <svg role="img" aria-label="Colour legend" data-testid="legend" width={W + 150} height={60} viewBox={`0 0 ${W + 150} 60`}>
      <defs>
        <linearGradient id="explore-legend-grad">
          {stops.map((c, k) => (
            <stop key={k} offset={`${k * 10}%`} stopColor={c} />
          ))}
        </linearGradient>
      </defs>
      <rect x={10} y={8} width={W} height={14} fill="url(#explore-legend-grad)" />
      {ticks.map((e) => {
        const x = 10 + (hi > lo ? ((e - lo) / (hi - lo)) * W : 0);
        return (
          <text key={e} x={x} y={36} fontSize="10" textAnchor="middle">
            1e{e}
          </text>
        );
      })}
      <text x={10 + W / 2} y={52} fontSize="11" textAnchor="middle">
        median relative error in a (log scale)
      </text>
      <rect x={W + 30} y={8} width={14} height={14} fill="#d8d8d8" />
      <text x={W + 50} y={20} fontSize="11">
        no data (all trials failed)
      </text>
    </svg>
  );
}

const SERIES: { key: string; label: string; color: string; pick: Pick }[] = [
  { key: 'gauss', label: 'Gauss (iterated)', color: '#1f77b4', pick: (c) => c.gaussAErrMedian },
  { key: 'laplace', label: 'Laplace (classical)', color: '#d62728', pick: (c) => c.laplaceAErrMedian },
  { key: 'first', label: 'Gauss first approximation', color: '#2ca02c', pick: (c) => c.gaussFirstAErrMedian },
];

function LineChart({ grid, noiseIdx, lo, hi }: { grid: SweepCell[][]; noiseIdx: number; lo: number; hi: number }) {
  const xs = grid.map((r) => r[0]!.spacing);
  const W = 460;
  const H = 260;
  const L = 60;
  const T = 14;
  const B = 44;
  const pw = W - L - 20;
  const ph = H - T - B;
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const px = (x: number) => L + (xmax > xmin ? ((x - xmin) / (xmax - xmin)) * pw : pw / 2);
  const py = (v: number) => T + ph - (hi > lo ? ((Math.log10(Math.max(v, FLOOR)) - lo) / (hi - lo)) * ph : ph / 2);
  const yt: number[] = [];
  for (let e = Math.ceil(lo); e <= Math.floor(hi); e++) yt.push(e);
  return (
    <svg role="img" aria-label="Median relative error versus spacing" data-testid="linechart" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <rect x={L} y={T} width={pw} height={ph} fill="none" stroke="#888" />
      {yt.map((e) => (
        <g key={e}>
          <line x1={L} x2={L + pw} y1={py(10 ** e)} y2={py(10 ** e)} stroke="#ddd" />
          <text x={L - 4} y={py(10 ** e) + 3} fontSize="10" textAnchor="end">
            1e{e}
          </text>
        </g>
      ))}
      {xs.map((x, i) => (
        <text key={i} x={px(x)} y={T + ph + 14} fontSize="10" textAnchor="middle">
          {x}
        </text>
      ))}
      {SERIES.map((s) => {
        const pts = grid.map((r) => ({ x: r[0]!.spacing, v: s.pick(r[noiseIdx]!) })).filter((p): p is { x: number; v: number } => p.v !== null);
        return (
          <g key={s.key} data-testid={`series-${s.key}`}>
            <polyline fill="none" stroke={s.color} strokeWidth="2" points={pts.map((p) => `${px(p.x)},${py(p.v)}`).join(' ')} />
            {pts.map((p, i) => (
              <circle key={i} cx={px(p.x)} cy={py(p.v)} r="3" fill={s.color} />
            ))}
          </g>
        );
      })}
      <text x={L + pw / 2} y={H - 6} fontSize="12" textAnchor="middle">
        spacing between observations (days)
      </text>
      <text x={12} y={T + ph / 2} fontSize="12" textAnchor="middle" transform={`rotate(-90 12 ${T + ph / 2})`}>
        median relative error in a (log)
      </text>
    </svg>
  );
}

export default function ExplorePage() {
  const bodies = useMemo(() => loadCatalog().filter((c) => c.kind === 'asteroid'), []);
  const [bodyId, setBodyId] = useState(bodies.find((b) => b.id === '1')?.id ?? bodies[0]?.id ?? '');
  const [spacingText, setSpacingText] = useState('2, 5, 10, 20');
  const [noiseText, setNoiseText] = useState('0, 1, 3, 10');
  const [trials, setTrials] = useState('5');
  const [seed, setSeed] = useState('1');
  const [err, setErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [grid, setGrid] = useState<SweepCell[][] | null>(null);
  const [lineNoise, setLineNoise] = useState(0);
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);

  const run = () => {
    try {
      const entry = bodies.find((b) => b.id === bodyId);
      if (!entry) throw new Error('Choose a catalog body.');
      const spacings = parseList(spacingText, 'Spacings', 0, true);
      const noiseArcsec = parseList(noiseText, 'Noise', 0, false);
      const nt = Number(trials);
      if (!Number.isInteger(nt) || nt < 1 || nt > MAX_TRIALS) throw new Error(`Trials must be an integer from 1 to ${MAX_TRIALS}.`);
      const sd = Number(seed);
      if (!Number.isInteger(sd)) throw new Error('Seed must be an integer.');
      const el = entry.body as OrbitalElements;
      const params: SweepParams = { el, startJd: bestElongationStart(el), spacings, noiseArcsec, trials: nt, seed: sd };
      cancel.current?.();
      setErr(null);
      setRunning(true);
      setProgress({ done: 0, total: spacings.length * noiseArcsec.length });
      setGrid(null);
      setLineNoise(0);
      cancel.current = startSweep(
        params,
        (done, total) => setProgress({ done, total }),
        (g) => {
          setGrid(g);
          setRunning(false);
        },
        (m) => {
          setErr(m);
          setRunning(false);
        },
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  // Shared log colour domain across the heatmaps and the line chart.
  const domain = useMemo(() => {
    if (!grid) return { lo: -8, hi: 0 };
    const vals = grid.flat().flatMap((c) => [c.gaussAErrMedian, c.laplaceAErrMedian, c.gaussFirstAErrMedian]).filter((v): v is number => v !== null);
    if (vals.length === 0) return { lo: -8, hi: 0 };
    const lo = Math.floor(Math.log10(Math.max(Math.min(...vals), FLOOR)));
    let hi = Math.ceil(Math.log10(Math.max(...vals, FLOOR)));
    if (hi <= lo) hi = lo + 1;
    return { lo, hi };
  }, [grid]);

  return (
    <section>
      <h1>Explore sensitivity</h1>
      <p>
        Synthetic three-night observations of a catalog body are perturbed with Gaussian noise (per coordinate, applied to RA·cos Dec and Dec) and solved with Gauss and with{' '}
        <em>classical</em> (non-iterated) Laplace. Iterated Laplace converges to the same answer as Gauss, so it is not shown. The error is the relative semi-major-axis error |a − a_true| / a_true, compared directly because a is
        constant under two-body motion. Failed trials (solver error or non-elliptic result) are excluded from the median.
      </p>
      <div>
        <label>
          Body{' '}
          <select value={bodyId} onChange={(e) => setBodyId(e.target.value)}>
            {bodies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          Spacings, days (up to {MAX_AXIS}) <input aria-label="Spacings" value={spacingText} onChange={(e) => setSpacingText(e.target.value)} />
        </label>{' '}
        <label>
          Noise sigma, arcsec (up to {MAX_AXIS}) <input aria-label="Noise" value={noiseText} onChange={(e) => setNoiseText(e.target.value)} />
        </label>{' '}
        <label>
          Trials (max {MAX_TRIALS}) <input aria-label="Trials" value={trials} onChange={(e) => setTrials(e.target.value)} size={4} />
        </label>{' '}
        <label>
          Seed <input aria-label="Seed" value={seed} onChange={(e) => setSeed(e.target.value)} size={6} />
        </label>{' '}
        <button type="button" onClick={run} disabled={running}>
          {running ? 'Running…' : 'Run sweep'}
        </button>
      </div>
      <p>The start date is chosen automatically near the date of maximum solar elongation within 400 days of the catalog epoch.</p>
      {err && <p role="alert">{err}</p>}
      {progress && running && (
        <p>
          <progress value={progress.done} max={progress.total} /> <span data-testid="progress">{progress.done} / {progress.total} cells</span>
        </p>
      )}
      {grid && (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
            <Heatmap title="Gauss (iterated): median relative error in a" grid={grid} pick={(c) => c.gaussAErrMedian} lo={domain.lo} hi={domain.hi} />
            <Heatmap title="Laplace (classical): median relative error in a" grid={grid} pick={(c) => c.laplaceAErrMedian} lo={domain.lo} hi={domain.hi} />
          </div>
          <Legend lo={domain.lo} hi={domain.hi} />
          <h2>Error versus spacing</h2>
          <label>
            Fixed noise sigma (arcsec){' '}
            <select aria-label="Fixed noise" value={lineNoise} onChange={(e) => setLineNoise(Number(e.target.value))}>
              {grid[0]!.map((c, j) => (
                <option key={j} value={j}>
                  {c.noise}
                </option>
              ))}
            </select>
          </label>
          <LineChart grid={grid} noiseIdx={lineNoise} lo={domain.lo} hi={domain.hi} />
          <ul>
            {SERIES.map((s) => (
              <li key={s.key} style={{ color: s.color }}>
                {s.label}
              </li>
            ))}
          </ul>
          <h2>What to look for</h2>
          <ul>
            <li>Compare the two heatmaps cell by cell: does one method&apos;s error grow faster toward the high-noise columns or the short-spacing rows?</li>
            <li>At zero noise, both errors should be small; check how large the classical Laplace error is on its own at long spacings.</li>
            <li>In the line chart, look at whether the curves cross, and whether the first Gauss approximation sits above or below the refined result.</li>
            <li>Grey cells mean every trial failed; check whether they cluster at short spacings or high noise. Changing the seed or trial count shows how stable any pattern is.</li>
          </ul>
        </div>
      )}
    </section>
  );
}
