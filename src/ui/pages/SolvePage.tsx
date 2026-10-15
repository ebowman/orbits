import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDec, formatRA, loadCatalog, type IODInput, type Observation, type OrbitalElements } from '@astro';
import { useStore } from '../store';
import {
  ELEMENT_KEYS,
  ELEMENT_LABEL,
  FORWARD_DAYS,
  METHOD_IDS,
  METHOD_LABEL,
  candidates,
  checkResidualRad,
  commonEpoch,
  formatCheckResidual,
  elementError,
  elementValues,
  forwardPredictions,
  methodElements,
  propagateElements,
  residuals,
  runSolvers,
  severity,
  type ElementKey,
} from '../solve/compute';

const fmt = (x: number, key: ElementKey): string => {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '—';
  return key === 'e' ? x.toFixed(6) : x.toFixed(5);
};
const fmtPct = (p: number): string => (!Number.isFinite(p) ? String(p) : p !== 0 && p < 0.01 ? p.toExponential(1) : p.toFixed(2));
const fmtAbs = (x: number): string => (!Number.isFinite(x) ? String(x) : x !== 0 && Math.abs(x) < 0.001 ? x.toExponential(2) : x.toFixed(4));

function ErrCells({ id, k, value, cat }: { id: string; k: ElementKey; value: number; cat: number }) {
  const err = elementError(k, value, cat);
  return (
    <>
      <span className={`solve-err sev-${severity(err.pct)}`} data-testid={`abs-${id}-${k}`}>
        Δ {fmtAbs(err.abs)}
      </span>
      <span className={`solve-err sev-${severity(err.pct)}`} data-testid={`pct-${id}-${k}`}>
        {fmtPct(err.pct)} %
      </span>
    </>
  );
}

export default function SolvePage() {
  const sets = useStore((s) => s.observationSets);
  const activeSetId = useStore((s) => s.activeSetId);
  const [setOverride, setSetOverride] = useState<string | null>(null);
  const [targetOverride, setTargetOverride] = useState<string | null>(null);
  const [pickedR2, setPickedR2] = useState<number | null>(null);

  const set = sets.find((x) => x.id === (setOverride ?? activeSetId)) ?? sets[0];
  const catalog = useMemo(() => loadCatalog().filter((c) => c.kind === 'asteroid'), []);
  const targetId = targetOverride ?? set?.targetId ?? 'none';
  const target = catalog.find((c) => c.id === targetId);
  const catEl: OrbitalElements | null = target && 'a' in target.body ? target.body : null;

  const complete = !!set && set.observations.length === 3;
  const obsKey = complete ? JSON.stringify(set.observations) : '';
  const checkKey = complete && set.check ? JSON.stringify(set.check) : '';
  const analysis = useMemo(() => {
    if (!obsKey) return null;
    const obs = JSON.parse(obsKey) as IODInput;
    const check = checkKey ? (JSON.parse(checkKey) as Observation) : null;
    let outcomes = runSolvers(obs, pickedR2);
    let jd = commonEpoch(obs, outcomes);
    let cands = candidates(obs, outcomes, jd);
    const resid = new Map<number, number | null>();
    let best: { rootIndex: number; r2: number; res: number } | null = null;
    let ratio: number | null = null;
    if (check && cands) {
      for (const c of cands.survivors) resid.set(c.rootIndex, checkResidualRad(c.elements, check));
      const fin = cands.survivors
        .map((c) => ({ rootIndex: c.rootIndex, r2: c.r2, res: resid.get(c.rootIndex) ?? NaN }))
        .filter((c) => Number.isFinite(c.res))
        .sort((x, y) => x.res - y.res);
      if (cands.survivors.length > 1 && fin.length > 0) {
        best = fin[0]!;
        const second = fin[1];
        ratio = second ? (best.res === 0 ? Infinity : second.res / best.res) : null;
        // Auto-select the best-fitting survivor unless the user picked one manually.
        const cur = cands.survivors.find((c) => c.selected);
        if (pickedR2 === null && cur && cur.rootIndex !== best.rootIndex) {
          outcomes = runSolvers(obs, best.r2);
          jd = commonEpoch(obs, outcomes);
          cands = candidates(obs, outcomes, jd);
          resid.clear();
          if (cands) for (const c of cands.survivors) resid.set(c.rootIndex, checkResidualRad(c.elements, check));
        }
      }
    }
    return { obs, check, outcomes, jd, cands, candResid: resid, best, ratio };
  }, [obsKey, checkKey, pickedR2]);

  const analysisKey = obsKey + '|' + checkKey + '|' + pickedR2 + '|' + (catEl ? catEl.a : 'none');
  const view = useMemo(() => {
    if (!analysis) return null;
    const { obs, outcomes, jd } = analysis;
    const catProp = catEl ? propagateElements(catEl, jd) : null;
    const cols = METHOD_IDS.map((id) => {
      const o = outcomes[id];
      const el = methodElements(o);
      let values: Record<ElementKey, number> | null = null;
      let resid = null;
      let fwd = null;
      let checkRes: number | null = null;
      let err: string | null = o.ok ? null : o.error;
      if (el) {
        try {
          values = elementValues(propagateElements(el, jd));
          resid = residuals(el, obs);
          fwd = forwardPredictions(el, obs, catEl);
          if (analysis.check) checkRes = checkResidualRad(el, analysis.check);
        } catch (e) {
          err = e instanceof Error ? e.message : String(e);
        }
      }
      return { id, o, values, resid, fwd, checkRes, err };
    });
    const catValues = catProp ? elementValues(catProp) : null;
    const catFwd = catEl ? forwardPredictions(catEl, obs, null) : null;
    return { cols, catValues, catFwd, catProp };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisKey]);

  const sel = (
    <p>
      <label>
        Observation set{' '}
        <select
          value={set?.id ?? ''}
          onChange={(e) => {
            setSetOverride(e.target.value);
            setTargetOverride(null);
            setPickedR2(null);
          }}
        >
          {sets.length === 0 && <option value="">(none)</option>}
          {sets.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>{' '}
      <label>
        Compare to{' '}
        <select value={target ? targetId : 'none'} onChange={(e) => setTargetOverride(e.target.value)}>
          <option value="none">none</option>
          {catalog.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </p>
  );

  if (!complete || !analysis || !view) {
    return (
      <section>
        <h1>Solve orbit</h1>
        {sel}
        <p role="alert" data-testid="incomplete">
          Incomplete set — enter 3 valid observations on the <Link to="/observe">Observe page</Link>
        </p>
      </section>
    );
  }

  const { obs, check, outcomes, jd, cands, candResid, best, ratio } = analysis;
  const multi = cands !== null && cands.survivors.length > 1;
  const rejected = cands ? cands.all.filter((r) => !r.accepted) : [];
  const catCol = view.catValues;

  return (
    <section>
      <h1>Solve orbit</h1>
      {sel}

      {multi && cands && (() => {
        const n = cands.survivors.length;
        const base = `Ambiguous: ${n} physically valid solutions — three observations can't distinguish them`;
        if (!check) {
          return (
            <div role="alert" className="ambiguous-banner" data-testid="ambiguous-banner">
              {base}. Add a 4th check observation on Observe to resolve this.
            </div>
          );
        }
        if (best && ratio !== null && ratio >= 10) {
          const others = cands.survivors
            .filter((c) => c.rootIndex !== best.rootIndex)
            .map((c) => formatCheckResidual(candResid.get(c.rootIndex) ?? null));
          return (
            <div role="status" className="resolved-banner" data-testid="resolved-banner">
              Resolved by 4th observation: root r2 = {best.r2.toFixed(4)} AU fits the check obs to {formatCheckResidual(best.res)}; the
              alternative misses by {others.join(', ')}.
            </div>
          );
        }
        return (
          <div role="alert" className="ambiguous-banner" data-testid="ambiguous-banner">
            {base}; the 4th observation does not clearly separate them.
          </div>
        );
      })()}

      <h2>Elements at the common epoch</h2>
      <p>
        Epoch: JD {jd.toFixed(5)} TT (the Gauss middle body time). Every solution and the catalog are brought to this epoch by
        two-body propagation. Catalog elements are osculating at their own epoch and are propagated two-body, with no
        perturbations, so the catalog column (and every error against it) carries a small perturbation error that grows with the
        interval from the catalog epoch.
      </p>
      <table className="solve-table" aria-label="Elements">
        <thead>
          <tr>
            <th>Element</th>
            {view.cols.map((c) => (
              <th key={c.id}>{METHOD_LABEL[c.id]}</th>
            ))}
            {catCol && <th>Catalog ({target?.name})</th>}
          </tr>
        </thead>
        <tbody>
          {ELEMENT_KEYS.map((k) => (
            <tr key={k}>
              <td>{ELEMENT_LABEL[k]}</td>
              {view.cols.map((c) => (
                <td key={c.id} data-testid={`cell-${c.id}-${k}`}>
                  {c.values ? (
                    <>
                      {fmt(c.values[k], k)}
                      {catCol && <ErrCells id={c.id} k={k} value={c.values[k]} cat={catCol[k]} />}
                    </>
                  ) : k === 'a' ? (
                    <span role="alert" className="error" data-testid={`error-${c.id}`}>
                      {c.err}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              ))}
              {catCol && <td>{fmt(catCol[k], k)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Convergence and warnings</h2>
      <ul>
        {METHOD_IDS.map((id) => {
          const o = outcomes[id];
          return (
            <li key={id} data-testid={`diag-${id}`}>
              <strong>{METHOD_LABEL[id]}</strong>:{' '}
              {o.ok ? (
                <>
                  {o.result.converged ? 'converged' : 'NOT converged'}
                  {` (${o.result.iterations} iterations)`}
                  {o.result.warnings.length > 0 && (
                    <ul>
                      {o.result.warnings.map((w, i) => (
                        <li key={i} className="warning">
                          {w}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <span className="error">failed: {o.error}</span>
              )}
            </li>
          );
        })}
      </ul>

      {cands && (cands.survivors.length > 1 || rejected.length > 0) && (
        <>
          <h2>Candidate roots ({METHOD_LABEL[cands.method]})</h2>
          <table className="solve-table" aria-label="Candidate roots">
            <thead>
              <tr>
                <th>r2 (AU)</th>
                <th>a (AU)</th>
                <th>e</th>
                <th>i (deg)</th>
                {check && <th>Check obs residual</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {cands.survivors.map((c) => {
                const v = elementValues(c.elements);
                return (
                  <tr key={c.rootIndex} data-testid={`candidate-${c.rootIndex}`}>
                    <td>{c.r2.toFixed(4)}</td>
                    {(['a', 'e', 'i'] as const).map((k) => (
                      <td key={k}>
                        {fmt(v[k], k)}
                        {catCol && <ErrCells id={`cand${c.rootIndex}`} k={k} value={v[k]} cat={catCol[k]} />}
                      </td>
                    ))}
                    {check && <td data-testid={`candidate-check-${c.rootIndex}`}>{formatCheckResidual(candResid.get(c.rootIndex) ?? null)}</td>}
                    <td>
                      {c.selected ? (
                        'selected'
                      ) : (
                        <button type="button" onClick={() => setPickedR2(c.r2)}>
                          use this root
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rejected.length > 0 && (
            <details>
              <summary>Rejected roots ({rejected.length})</summary>
              <ul>
                {rejected.map((r) => (
                  <li key={r.index}>
                    r2 = {r.r2.toFixed(4)} AU: {r.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <h2>Residuals (O−C, arcsec)</h2>
      <table className="solve-table" aria-label="Residuals">
        <thead>
          <tr>
            <th>Observation</th>
            {view.cols.map((c) => (
              <th key={c.id}>{METHOD_LABEL[c.id]} (RA·cosδ, Dec)</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {obs.map((_, n) => (
            <tr key={n}>
              <td>{n + 1}</td>
              {view.cols.map((c) => (
                <td key={c.id}>
                  {c.resid ? `${(c.resid[n]?.raCosDecArcsec ?? NaN).toFixed(3)}, ${(c.resid[n]?.decArcsec ?? NaN).toFixed(3)}` : '—'}
                </td>
              ))}
            </tr>
          ))}
          {check && (
            <tr>
              <td>Check obs residual</td>
              {view.cols.map((c) => (
                <td key={c.id} data-testid={`check-resid-${c.id}`}>
                  {formatCheckResidual(c.checkRes)}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>

      <h2>Did we find it again?</h2>
      <p>
        Predicted position {FORWARD_DAYS.join(', ')} days after the last observation (same site as observation 3)
        {catEl ? ', with separation from the catalog prediction in arcminutes.' : '. Choose a comparison target to see separations.'}
      </p>
      <table className="solve-table" aria-label="Forward predictions">
        <thead>
          <tr>
            <th>Days after last</th>
            {view.cols.map((c) => (
              <th key={c.id}>{METHOD_LABEL[c.id]}</th>
            ))}
            {view.catFwd && <th>Catalog</th>}
          </tr>
        </thead>
        <tbody>
          {FORWARD_DAYS.map((d, n) => (
            <tr key={d}>
              <td>+{d}</td>
              {view.cols.map((c) => {
                const p = c.fwd?.[n];
                return (
                  <td key={c.id} data-testid={`fwd-${c.id}-${d}`}>
                    {p ? (
                      <>
                        {formatRA(p.raRad, 1)} {formatDec(p.decRad, 0)}
                        {p.sepArcmin !== null && <span className="solve-err">{p.sepArcmin.toFixed(2)} arcmin</span>}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                );
              })}
              {view.catFwd && (
                <td>
                  {formatRA(view.catFwd[n]?.raRad ?? 0, 1)} {formatDec(view.catFwd[n]?.decRad ?? 0, 0)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
