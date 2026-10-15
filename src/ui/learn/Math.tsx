import { Fragment, useMemo, type ReactNode } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

type Seg = { kind: 'text'; s: string } | { kind: 'math'; s: string; display: boolean };

/** Split text into plain and math segments. Recognises $$...$$ (display) and $...$ (inline). */
export function splitMath(text: string): Seg[] {
  const out: Seg[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'text', s: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'math', s: m[1], display: true });
    else out.push({ kind: 'math', s: m[2] as string, display: false });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', s: text.slice(last) });
  return out;
}

function renderTex(tex: string, display: boolean): string | null {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false, output: 'html' });
  } catch {
    return null;
  }
}

/**
 * Renders text containing $...$ / $$...$$ math with KaTeX. Everything outside math is emitted as React
 * text nodes (escaped); only KaTeX's own output (trust:false) is injected as HTML.
 */
export default function MathText({ text }: { text: string }): ReactNode {
  const segs = useMemo(() => splitMath(text), [text]);
  return (
    <>
      {segs.map((sg, i) => {
        if (sg.kind === 'text') return <Fragment key={i}>{sg.s}</Fragment>;
        const html = renderTex(sg.s, sg.display);
        if (html === null) return <Fragment key={i}>{sg.s}</Fragment>;
        return (
          <span
            key={i}
            className={sg.display ? 'math-display' : 'math-inline'}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </>
  );
}
