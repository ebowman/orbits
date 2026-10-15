/// <reference lib="webworker" />
import { sweep, type SweepCell, type SweepParams } from '@astro';

export type SweepRequest = { type: 'run'; params: SweepParams };
export type SweepMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; grid: SweepCell[][] }
  | { type: 'error'; message: string };

const ctx = self as unknown as { postMessage(m: SweepMessage): void; onmessage: ((e: MessageEvent<SweepRequest>) => void) | null };

ctx.onmessage = (e) => {
  if (e.data.type !== 'run') return;
  try {
    const grid = sweep(e.data.params, { onProgress: (done, total) => ctx.postMessage({ type: 'progress', done, total }) });
    ctx.postMessage({ type: 'done', grid });
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
