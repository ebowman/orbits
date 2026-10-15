import { useMemo } from 'react';
import { add, gauss, scale, type IODResult, type OrbitalElements, type TraceStep } from '@astro';
import { ceresExample, findBody, isVec, nums, num, orbitFromState, useIodSource, vec, type Source } from '../learn/source';
import Walkthrough, { type StepOverlay } from '../learn/Walkthrough';
import MathText from '../learn/Math';

const INTRO =
  "Gauss's insight: three lines of sight from a moving Earth fix an orbit if you know how the object's positions $\\mathbf r_1, \\mathbf r_2, \\mathbf r_3$ relate. Because the motion is in one plane, $\\mathbf r_2$ is a combination of the other two, $c_1\\mathbf r_1 + c_3\\mathbf r_3 = \\mathbf r_2$, and the weights are ratios of the triangle areas those positions span. Over short arcs the area of the orbital sector between two positions is close to the triangle area, and the Lagrange $f$ and $g$ series in $\\tau$ and $1/r_2^3$ express the ratio in terms of $r_2$ alone. That yields an eighth-degree polynomial in $r_2$. Each positive root gives slant ranges and a state, which is then refined iteratively with the exact $f$ and $g$ functions. Step through the computation below.";

const HELIO_COLORS = ['#ffd24a', '#ff9f4a', '#ff6f6f'];

function mix(hex: string, bg: string, t: number): string {
  const p = (h: string, o: number) => parseInt(h.slice(1 + o, 3 + o), 16);
  const c = [0, 2, 4].map((o) => Math.round(p(hex, o) * t + p(bg, o) * (1 - t)));
  return `#${c.map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** Evaluate x^8 + a x^6 + b x^3 + c. */
const poly = (x: number, a: number, b: number, c: number): number => x ** 8 + a * x ** 6 + b * x ** 3 + c;
const slog = (y: number): number => Math.sign(y) * Math.log10(1 + Math.abs(y));

export function RootsPlot({ a, b, c, roots, chosen }: { a: number; b: number; c: number; roots: number[]; chosen: number }) {
  const W = 400;
  const H = 220;
  const pad = 28;
  const xmax = Math.max(3, ...roots.map((r) => r * 1.25), chosen * 1.25);
  const N = 240;
  const xs = Array.from({ length: N + 1 }, (_, k) => (k / N) * xmax);
  const ys = xs.map((x) => slog(poly(x, a, b, c)));
  const ylo = Math.min(...ys, -0.5);
  const yhi = Math.max(...ys, 0.5);
  const sx = (x: number) => pad + (x / xmax) * (W - 2 * pad);
  const sy = (y: number) => H - pad - ((y - ylo) / (yhi - ylo)) * (H - 2 * pad);
  const path = xs.map((x, k) => `${k === 0 ? 'M' : 'L'}${sx(x).toFixed(1)},${sy(ys[k] as number).toFixed(1)}`).join(' ');
  return (
    <svg className="walk-plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Eighth-degree polynomial in r2" data-testid="roots-plot">
      <line x1={pad} x2={W - pad} y1={sy(0)} y2={sy(0)} stroke="#888" strokeWidth={1} />
      <path d={path} fill="none" stroke="#4aa3ff" strokeWidth={1.5} />
      {roots.map((r, k) => {
        const isChosen = Math.abs(r - chosen) < 1e-9;
        return (
          <g key={k} data-testid={isChosen ? 'root-chosen' : 'root'}>
            <circle cx={sx(r)} cy={sy(0)} r={isChosen ? 6 : 4} fill={isChosen ? '#2e9e4f' : '#d9a000'} stroke={isChosen ? '#fff' : 'none'} />
            <text x={sx(r)} y={sy(0) - 9} fontSize={10} textAnchor="middle" fill="currentColor">
              {r.toFixed(3)}
            </text>
          </g>
        );
      })}
      <text x={W / 2} y={H - 6} fontSize={10} textAnchor="middle" fill="currentColor">
        r2 (AU); vertical axis: signed log10(1+|P|)
      </text>
    </svg>
  );
}

function overlaysFor(step: TraceStep, trace: TraceStep[], catalogEl: OrbitalElements | null): StepOverlay {
  const R = ['R1', 'R2', 'R3'].map((k) => vec(trace, 'observer-positions', k));
  const L = ['L1', 'L2', 'L3'].map((k) => vec(trace, 'los-vectors', k));
  const rho = nums(trace, 'slant-ranges', 'rho');
  const jdTt2 = num(trace, 'observer-positions', 'jdTt2');
  const earth = (labels: string[]) =>
    R.flatMap((p, k) => (p ? [{ pos: p, color: '#4aa3ff', label: labels[k] as string }] : []));
  const earthPts = earth(['Earth t1', 'Earth t2', 'Earth t3']);
  const raysAt = (len: (k: number) => number, color: string) =>
    R.flatMap((p, k) => {
      const d = L[k];
      return p && d ? [{ from: p, dir: d, length: len(k), color, label: `L${k + 1}` }] : [];
    });
  const out: StepOverlay = {};
  const id = step.id;
  const final = trace.find((s) => s.id === 'final-state');
  // Prefer the light-time-corrected epoch of the final state over the uncorrected observation epoch.
  const epoch = typeof final?.values.jdTt2 === 'number' ? final.values.jdTt2 : jdTt2;
  const finalEl = orbitFromState(
    isVec(final?.values.r2) ? final.values.r2 : null,
    isVec(final?.values.v2) ? final.values.v2 : null,
    epoch,
  );

  if (id === 'los-vectors' || id === 'time-intervals' || id === 'd-scalars' || id === 'polynomial') {
    out.rays = raysAt(() => 2, '#ffd24a');
    if (id !== 'los-vectors') out.points = earthPts;
  } else if (id === 'observer-positions') {
    out.points = earthPts;
    out.rays = raysAt(() => 2, '#ffd24a');
  } else if (id === 'roots') {
    const v = step.values;
    const pv = trace.find((s) => s.id === 'polynomial')?.values;
    out.points = earthPts;
    out.rays = raysAt(() => 2, '#7a6a30');
    const roots = Array.isArray(v.roots) ? (v.roots as number[]) : [];
    const chosen = typeof v.chosenRoot === 'number' ? v.chosenRoot : NaN;
    if (pv && typeof pv.a === 'number' && typeof pv.b === 'number' && typeof pv.c === 'number') {
      out.extra = (
        <div>
          <RootsPlot a={pv.a} b={pv.b} c={pv.c} roots={roots} chosen={chosen} />
          <p style={{ fontSize: '0.85em' }}>
            Orange: candidate roots. Green: accepted root, r2 = {Number.isFinite(chosen) ? chosen.toFixed(4) : '?'} AU.
          </p>
        </div>
      );
    }
  } else if (id === 'slant-ranges') {
    out.points = [
      ...earthPts,
      ...R.flatMap((p, k) => {
        const d = L[k];
        return p && d && rho ? [{ pos: add(p, scale(d, rho[k] as number)), color: HELIO_COLORS[k] as string, label: `r${k + 1}` }] : [];
      }),
    ];
    out.rays = raysAt((k) => (rho ? (rho[k] as number) : 2), '#ffd24a');
  } else if (id === 'initial-orbit') {
    out.points = ['r1', 'r2', 'r3'].flatMap((k, n) => {
      const p = step.values[k];
      return isVec(p) ? [{ pos: p, color: HELIO_COLORS[n] as string, label: k }] : [];
    });
    const el = orbitFromState(isVec(step.values.r2) ? step.values.r2 : null, isVec(step.values.v2) ? step.values.v2 : null, jdTt2);
    if (el) out.orbits = [{ elements: el, color: '#7fe0a0', label: 'initial orbit' }];
  } else if (id.startsWith('iteration-')) {
    const n = Number(id.slice('iteration-'.length));
    out.points = ['r1', 'r2', 'r3'].flatMap((k, j) => {
      const p = step.values[k];
      return isVec(p) ? [{ pos: p, color: HELIO_COLORS[j] as string, label: k }] : [];
    });
    const orbits: { elements: OrbitalElements; color: string; label: string }[] = [];
    // Older iterations fade toward the background; show the three before this one.
    for (let m = Math.max(1, n - 3); m <= n; m++) {
      const s = trace.find((t) => t.id === `iteration-${m}`);
      const el = orbitFromState(isVec(s?.values.r2) ? s.values.r2 : null, isVec(s?.values.v2) ? s.values.v2 : null, typeof s?.values.jdTt2 === 'number' ? s.values.jdTt2 : epoch);
      if (el) orbits.push({ elements: el, color: mix('#7fe0a0', '#222222', m === n ? 1 : 0.7 - 0.2 * (n - m - 1)), label: `iteration ${m}` });
    }
    out.orbits = orbits;
  } else if (id === 'final-state') {
    out.points = isVec(step.values.r2) ? [{ pos: step.values.r2, color: '#7fe0a0', label: 'r2 (final)' }] : [];
    if (finalEl) out.orbits = [{ elements: finalEl, color: '#7fe0a0', label: 'solved orbit' }];
  } else if (id === 'elements') {
    const orbits: NonNullable<StepOverlay['orbits']> = [];
    if (finalEl) orbits.push({ elements: finalEl, color: '#7fe0a0', label: 'solved orbit' });
    if (catalogEl) orbits.push({ elements: catalogEl, color: '#ffffff', label: 'catalog orbit', dashed: true });
    out.orbits = orbits;
    if (jdTt2 !== null) out.jd = jdTt2;
  }
  return out;
}

export default function LearnGaussPage() {
  const { active, storeObs, source, setChoice } = useIodSource();

  const { result, error, catalogEl, label } = useMemo(() => {
    const obs = source === 'store' && storeObs ? storeObs : ceresExample();
    const tgt = source === 'store' ? findBody(active?.targetId) : findBody('1');
    try {
      return { result: gauss(obs) as IODResult, error: null, catalogEl: tgt?.el ?? null, label: source === 'store' ? `observation set "${active?.name}"` : 'built-in synthetic Ceres example' };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : String(e), catalogEl: null, label: '' };
    }
  }, [source, storeObs, active]);

  return (
    <section>
      <h1>Learn: Gauss method</h1>
      <p data-testid="gauss-intro">
        <MathText text={INTRO} />
      </p>
      <p data-testid="data-source">
        Data source: {source === 'store' ? `your active ${label}` : label}
        {storeObs ? (
          <>
            {' '}
            <label>
              Use{' '}
              <select aria-label="Data source" value={source} onChange={(e) => setChoice(e.target.value as Source)}>
                <option value="store">Active observation set</option>
                <option value="example">Built-in Ceres example</option>
              </select>
            </label>
          </>
        ) : null}
      </p>
      {error ? (
        <p role="alert">Gauss method failed on this data: {error}</p>
      ) : result ? (
        <Walkthrough
          key={source + (active?.id ?? '')}
          trace={result.trace}
          overlaysFor={(step, _i, trace) => overlaysFor(step, trace, catalogEl)}
        />
      ) : null}
    </section>
  );
}
