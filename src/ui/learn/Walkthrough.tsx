/**
 * Reusable step-through UI for an IOD computation trace. Left: 3D scene; right: Prev/Next/slider,
 * step title, explanation (KaTeX), optional extra panel (e.g. a plot) and a key/value table.
 * Method-specific parts are supplied by the caller via `overlaysFor`.
 */
import { lazy, Suspense, useState, type ReactNode } from 'react';
import type { TraceStep } from '@astro';
import type { SceneOrbit, ScenePoint, SceneRay } from '../scene/OrbitScene';
import MathText from './Math';

const OrbitScene = lazy(() => import('../scene/OrbitScene'));

export type StepOverlay = {
  orbits?: SceneOrbit[];
  points?: ScenePoint[];
  rays?: SceneRay[];
  /** TT Julian date for body markers on the orbits. */
  jd?: number;
  /** Extra content shown between the explanation and the values table. */
  extra?: ReactNode;
};

export type WalkthroughProps = {
  trace: TraceStep[];
  overlaysFor: (step: TraceStep, index: number, trace: TraceStep[]) => StepOverlay;
  intro?: ReactNode;
};

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function formatNumber(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return '0';
  const ax = Math.abs(x);
  if (ax < 1e-4 || ax >= 1e7) return x.toExponential(6);
  return String(Number(x.toPrecision(10)));
}

export function formatValue(v: TraceStep['values'][string]): string {
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'string') return v;
  return `[${v.map(formatNumber).join(', ')}]`;
}

export default function Walkthrough({ trace, overlaysFor, intro }: WalkthroughProps) {
  const [idx, setIdx] = useState(0);
  const [gl] = useState(webglAvailable);
  if (trace.length === 0) return <p>No steps to show.</p>;
  const i = Math.min(idx, trace.length - 1);
  const step = trace[i] as TraceStep;
  const ov = overlaysFor(step, i, trace);
  return (
    <div className="walk">
      {intro}
      <div className="walk-grid">
        <div className="walk-scene">
          {gl ? (
            <Suspense fallback={<p>Loading 3D scene...</p>}>
              <OrbitScene orbits={ov.orbits} points={ov.points} rays={ov.rays} jd={ov.jd} />
            </Suspense>
          ) : (
            <p>WebGL not available</p>
          )}
        </div>
        <div className="walk-panel">
          <div className="walk-nav">
            <button type="button" onClick={() => setIdx(Math.max(0, i - 1))} disabled={i === 0}>
              Prev
            </button>
            <input
              type="range"
              aria-label="Step"
              min={0}
              max={trace.length - 1}
              step={1}
              value={i}
              onChange={(e) => setIdx(Number(e.target.value))}
            />
            <button type="button" onClick={() => setIdx(Math.min(trace.length - 1, i + 1))} disabled={i === trace.length - 1}>
              Next
            </button>
          </div>
          <p data-testid="step-counter">
            Step {i + 1} of {trace.length}
          </p>
          <h2 data-testid="step-title">{step.title}</h2>
          <p data-testid="step-explanation">
            <MathText text={step.explanation} />
          </p>
          {ov.extra}
          <table className="solve-table walk-values" data-testid="step-values">
            <tbody>
              {Object.entries(step.values).map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td data-testid={`value-${k}`}>{formatValue(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
