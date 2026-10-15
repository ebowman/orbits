import { useMemo } from 'react';
import { add, laplace, norm, scale, type IODResult, type OrbitalElements, type TraceStep, type Vec3 } from '@astro';
import Walkthrough, { type StepOverlay } from '../learn/Walkthrough';
import MathText from '../learn/Math';
import { ceresExample, findBody, isVec, num, orbitFromState, useIodSource, vec, type Source } from '../learn/source';
import { RootsPlot } from './LearnGaussPage';

const INTRO =
  "Laplace's idea: treat the direction to the object as a smooth function of time, $\\hat\\rho(t)$. Fit a quadratic through the three observed directions, then differentiate it at the middle time to get $\\hat\\rho'$ and $\\hat\\rho''$. Differentiating $\\mathbf r=\\mathbf R+\\rho\\hat\\rho$ twice and substituting Newton's law $\\mathbf r''=-\\mu\\mathbf r/r^3$ gives equations for the range $\\rho$ and range rate $\\rho'$ in terms of $r$, which collapse to the same eighth-degree polynomial as Gauss's method. The weakness is the differentiation: derivatives of a fit through nearby, noisy points amplify errors, and the quadratic is only accurate to second order in the time spread. So Laplace is sensitive to short arcs and measurement noise. Below, the classical result is compared with a refined one that reuses the exact motion model.";

const HELIO_COLORS = ['#ffd24a', '#ff9f4a', '#ff6f6f'];
const DEG = 180 / Math.PI;
const CLASSICAL = '#ff9f4a';
const REFINED = '#7fe0a0';

const raDec = (v: Vec3): { ra: number; dec: number } => ({ ra: Math.atan2(v[1], v[0]), dec: Math.asin(Math.max(-1, Math.min(1, v[2] / norm(v)))) });
/** Wrap an angle difference into (-pi, pi]. */
const wrapPi = (d: number): number => d - 2 * Math.PI * Math.round(d / (2 * Math.PI));

/**
 * 2D RA/Dec inset: the three observed directions, the interpolated quadratic L(t), and the L' and
 * L'' arrows at t2. RA is unwrapped around t2 so tracks crossing 0/360 deg stay continuous. Axes are
 * offsets from the t2 direction in degrees (x = -dRA*cos(dec2), so east is to the left as on the sky).
 */
export function SkyInset({ L, tau1, tau3, Lp, Lpp }: { L: [Vec3, Vec3, Vec3]; tau1: number; tau3: number; Lp: Vec3; Lpp: Vec3 }) {
  const W = 400;
  const H = 240;
  const pad = 34;
  const c2 = raDec(L[1]);
  const cosd = Math.cos(c2.dec);
  const proj = (v: Vec3): [number, number] => {
    const p = raDec(v);
    return [-wrapPi(p.ra - c2.ra) * cosd * DEG, (p.dec - c2.dec) * DEG];
  };
  const lag = (t: number): Vec3 => {
    const l1 = (t * (t - tau3)) / (tau1 * (tau1 - tau3));
    const l2 = ((t - tau1) * (t - tau3)) / (tau1 * tau3);
    const l3 = (t * (t - tau1)) / (tau3 * (tau3 - tau1));
    return add(add(scale(L[0], l1), scale(L[1], l2)), scale(L[2], l3));
  };
  const N = 60;
  const curve = Array.from({ length: N + 1 }, (_, k) => proj(lag(tau1 + ((tau3 - tau1) * k) / N)));
  const pts = L.map(proj);
  // Tangent-plane components of the derivatives, as displacements in degrees.
  const eRa: Vec3 = [-Math.sin(c2.ra), Math.cos(c2.ra), 0];
  const eDec: Vec3 = [-Math.sin(c2.dec) * Math.cos(c2.ra), -Math.sin(c2.dec) * Math.sin(c2.ra), Math.cos(c2.dec)];
  const comp = (v: Vec3): [number, number] => [
    -(v[0] * eRa[0] + v[1] * eRa[1] + v[2] * eRa[2]) * DEG,
    (v[0] * eDec[0] + v[1] * eDec[1] + v[2] * eDec[2]) * DEG,
  ];
  const dt = Math.abs(tau3 - tau1) / 4;
  const a1 = comp(scale(Lp, dt));
  const a2 = comp(scale(Lpp, (dt * dt) / 2));
  // Zero-length arrows (interpolation / line-of-sight steps) are not drawn and do not affect the extent.
  const show1 = norm(Lp) > 0;
  const show2 = norm(Lpp) > 0;
  const xs = [...curve.map((p) => p[0]), ...pts.map((p) => p[0]), 0, ...(show1 ? [a1[0]] : []), ...(show2 ? [a2[0]] : [])];
  const ys = [...curve.map((p) => p[1]), ...pts.map((p) => p[1]), 0, ...(show1 ? [a1[1]] : []), ...(show2 ? [a2[1]] : [])];
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-6) * 1.15;
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const k = (Math.min(W, H) - 2 * pad) / span;
  const sx = (x: number) => W / 2 + (x - cx) * k;
  const sy = (y: number) => H / 2 - (y - cy) * k;
  const path = curve.map((p, j) => `${j === 0 ? 'M' : 'L'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ');
  const arrow = (a: [number, number], color: string, id: string, label: string) => (
    <g data-testid={id}>
      <line x1={sx(0)} y1={sy(0)} x2={sx(a[0])} y2={sy(a[1])} stroke={color} strokeWidth={2} markerEnd="url(#sky-head)" />
      <text x={sx(a[0]) + 4} y={sy(a[1]) - 4} fontSize={11} fill={color}>
        {label}
      </text>
    </g>
  );
  const barDeg = Number((span / 4).toPrecision(1));
  return (
    <svg className="walk-plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Celestial sphere inset" data-testid="sky-inset">
      <defs>
        <marker id="sky-head" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill="context-stroke" />
        </marker>
      </defs>
      <path d={path} fill="none" stroke="#4aa3ff" strokeWidth={1.5} data-testid="sky-curve" />
      {pts.map((p, j) => (
        <g key={j} data-testid="sky-point">
          <circle cx={sx(p[0])} cy={sy(p[1])} r={4} fill={HELIO_COLORS[j]} />
          <text x={sx(p[0]) + 6} y={sy(p[1]) + 14} fontSize={10} fill="currentColor">
            {`t${j + 1}`}
          </text>
        </g>
      ))}
      {show1 && arrow(a1, '#2e9e4f', 'arrow-Lp', "L'")}
      {show2 && arrow(a2, '#e05050', 'arrow-Lpp', "L''")}
      <line x1={pad} x2={pad + barDeg * k} y1={H - 12} y2={H - 12} stroke="currentColor" />
      <text x={pad + barDeg * k + 6} y={H - 8} fontSize={10} fill="currentColor" data-testid="sky-scale">
        {`${barDeg} deg on sky`}
      </text>
      <text x={W - 6} y={14} fontSize={10} textAnchor="end" fill="currentColor">
        {`${show1 || show2 ? `arrows: L'x${dt.toFixed(1)} d and L''x(${dt.toFixed(1)} d)^2/2; ` : ''}centre RA ${((((c2.ra * DEG) % 360) + 360) % 360).toFixed(1)}, Dec ${(c2.dec * DEG).toFixed(1)} deg`}
      </text>
    </svg>
  );
}

const ELS: { k: keyof OrbitalElements; label: string; deg: boolean }[] = [
  { k: 'a', label: 'a (AU)', deg: false },
  { k: 'e', label: 'e', deg: false },
  { k: 'i', label: 'i (deg)', deg: true },
  { k: 'Omega', label: 'Omega (deg)', deg: true },
  { k: 'omega', label: 'omega (deg)', deg: true },
  { k: 'M0', label: 'M0 (deg)', deg: true },
];

export function ComparisonTable({ classical, refined }: { classical: OrbitalElements | null; refined: OrbitalElements | null }) {
  if (!classical || !refined) return null;
  const f = (x: number, deg: boolean) => (deg ? x * DEG : x);
  return (
    <table className="solve-table" data-testid="compare-table">
      <thead>
        <tr>
          <th>Element</th>
          <th>Classical</th>
          <th>Refined</th>
          <th>Refined - classical</th>
        </tr>
      </thead>
      <tbody>
        {ELS.map(({ k, label, deg }) => {
          const c = f(classical[k] as number, deg);
          const r = f(refined[k] as number, deg);
          const d = deg ? wrapPi((r - c) / DEG) * DEG : r - c;
          return (
            <tr key={k} data-testid={`cmp-${k}`}>
              <th scope="row">{label}</th>
              <td>{c.toPrecision(7)}</td>
              <td>{r.toPrecision(7)}</td>
              <td data-testid={`cmp-diff-${k}`}>{d.toExponential(2)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function elementsOf(trace: TraceStep[], id: string): OrbitalElements | null {
  const v = trace.find((s) => s.id === id)?.values;
  if (!v) return null;
  const g = (k: string) => (typeof v[k] === 'number' ? (v[k] as number) : NaN);
  const el = { a: g('a'), e: g('e'), i: g('i'), Omega: g('Omega'), omega: g('omega'), M0: g('M0'), epochJd: g('epochJd'), frame: 'eclipticJ2000' as const };
  return Object.values({ ...el, frame: 0 }).every(Number.isFinite) ? el : null;
}

function overlaysFor(step: TraceStep, _index: number, trace: TraceStep[], catalogEl: OrbitalElements | null): StepOverlay {
  const id = step.id;
  const R = vec(trace, 'observer-state', 'R');
  const Rp = vec(trace, 'observer-state', 'Rp');
  const L = ['L1', 'L2', 'L3'].map((k) => vec(trace, 'los-vectors', k));
  const L2 = L[1] ?? null;
  const earth = R ? [{ pos: R, color: '#4aa3ff', label: 'Earth t2' }] : [];
  const out: StepOverlay = {};

  const clEl = elementsOf(trace, 'classical-result');
  const clOrbit = orbitFromState(vec(trace, 'classical-result', 'r2'), vec(trace, 'classical-result', 'v2'), num(trace, 'classical-result', 'jdTt2'));
  const fin = trace.find((s) => s.id === 'final-state');
  const refOrbit = orbitFromState(isVec(fin?.values.r2) ? fin.values.r2 : null, isVec(fin?.values.v2) ? fin.values.v2 : null, typeof fin?.values.jdTt2 === 'number' ? fin.values.jdTt2 : null);
  const refEl = elementsOf(trace, 'elements');
  const jdTt2 = num(trace, 'final-state', 'jdTt2');
  const classicalLine = clOrbit ? [{ elements: clOrbit, color: CLASSICAL, label: 'classical Laplace', dashed: true }] : [];
  const refinedLine = refOrbit ? [{ elements: refOrbit, color: REFINED, label: 'refined' }] : [];
  const catalogLine = catalogEl ? [{ elements: catalogEl, color: '#ffffff', label: 'catalog orbit', dashed: true }] : [];
  const table = <ComparisonTable classical={clEl} refined={refEl} />;

  const sky = (() => {
    const tau1 = num(trace, 'interpolation', 'tau1');
    const tau3 = num(trace, 'interpolation', 'tau3');
    const Lp = vec(trace, 'derivatives', 'Lp');
    const Lpp = vec(trace, 'derivatives', 'Lpp');
    if (!L[0] || !L[1] || !L[2] || tau1 === null || tau3 === null) return null;
    const showD = id === 'derivatives' && Lp && Lpp;
    return (
      <SkyInset
        L={[L[0], L[1], L[2]]}
        tau1={tau1}
        tau3={tau3}
        Lp={showD ? Lp : [0, 0, 0]}
        Lpp={showD ? Lpp : [0, 0, 0]}
      />
    );
  })();

  if (id === 'los-vectors' || id === 'interpolation' || id === 'derivatives') {
    if (R) out.rays = L.flatMap((d, k) => (d ? [{ from: R, dir: d, length: 2, color: '#ffd24a', label: `L${k + 1}` }] : []));
    out.points = earth;
    out.extra = sky;
  } else if (id === 'observer-state') {
    out.points = earth;
    if (R && Rp) out.rays = [{ from: R, dir: Rp, length: 30 * norm(Rp), color: '#4aa3ff', label: 'Earth velocity (x30 d)' }];
  } else if (id === 'determinants' || id === 'polynomial' || id === 'roots') {
    out.points = earth;
    if (R && L2) out.rays = [{ from: R, dir: L2, length: 2, color: '#ffd24a', label: 'L2' }];
    if (id === 'roots') {
      const pv = trace.find((s) => s.id === 'polynomial')?.values;
      const roots = Array.isArray(step.values.roots) ? (step.values.roots as number[]) : [];
      const chosen = typeof step.values.chosenRoot === 'number' ? step.values.chosenRoot : NaN;
      if (pv && typeof pv.a === 'number' && typeof pv.b === 'number' && typeof pv.c === 'number') {
        out.extra = <RootsPlot a={pv.a} b={pv.b} c={pv.c} roots={roots} chosen={chosen} />;
      }
    }
  } else if (id === 'rho-rhodot') {
    const r = vec(trace, id, 'r2');
    const v = vec(trace, id, 'v2');
    const rho = num(trace, id, 'rho');
    out.points = [...earth, ...(r ? [{ pos: r, color: CLASSICAL, label: 'r2 (classical)' }] : [])];
    out.rays = [
      ...(R && L2 && rho !== null ? [{ from: R, dir: L2, length: rho, color: '#ffd24a', label: 'rho' }] : []),
      ...(r && v ? [{ from: r, dir: v, length: 30 * norm(v), color: CLASSICAL, label: 'v2 (x30 d)' }] : []),
    ];
    out.orbits = classicalLine;
  } else if (id === 'classical-result') {
    out.orbits = [...classicalLine, ...refinedLine, ...catalogLine];
    out.extra = table;
    if (jdTt2 !== null) out.jd = jdTt2;
  } else if (id.startsWith('iteration-')) {
    const r = isVec(step.values.r2) ? step.values.r2 : null;
    const v = isVec(step.values.v2) ? step.values.v2 : null;
    const it = orbitFromState(r, v, typeof step.values.jdTt2 === 'number' ? step.values.jdTt2 : jdTt2);
    out.orbits = [...classicalLine, ...(it ? [{ elements: it, color: REFINED, label: id }] : [])];
  } else if (id === 'final-state') {
    const r = isVec(step.values.r2) ? step.values.r2 : null;
    out.points = r ? [{ pos: r, color: REFINED, label: 'r2 (refined)' }] : [];
    out.orbits = [...classicalLine, ...refinedLine, ...catalogLine];
    if (jdTt2 !== null) out.jd = jdTt2;
  } else if (id === 'elements') {
    out.orbits = [...classicalLine, ...refinedLine, ...catalogLine];
    out.extra = table;
    if (jdTt2 !== null) out.jd = jdTt2;
  }
  return out;
}

export default function LearnLaplacePage() {
  const { active, storeObs, source, setChoice } = useIodSource();

  const { result, error, catalogEl, label } = useMemo(() => {
    const obs = source === 'store' && storeObs ? storeObs : ceresExample();
    const tgt = source === 'store' ? findBody(active?.targetId) : findBody('1');
    try {
      return {
        result: laplace(obs, { iterate: true }) as IODResult,
        error: null,
        catalogEl: tgt?.el ?? null,
        label: source === 'store' ? `observation set "${active?.name}"` : 'built-in synthetic Ceres example',
      };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : String(e), catalogEl: null, label: '' };
    }
  }, [source, storeObs, active]);

  return (
    <section>
      <h1>Learn: Laplace method</h1>
      <p data-testid="laplace-intro">
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
        <p role="alert">Laplace method failed on this data: {error}</p>
      ) : result ? (
        <Walkthrough
          key={source + (active?.id ?? '')}
          trace={result.trace}
          overlaysFor={(step, i, trace) => overlaysFor(step, i, trace, catalogEl)}
        />
      ) : null}
    </section>
  );
}
