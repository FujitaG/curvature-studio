import { acceptWorkerReply, createComputeMessage, type WorkerOut } from '../math/protocol';
import { queueComputation } from './computationQueue';
import { useEffect, useMemo, useRef } from 'react';
import { computationKeyForDoc, computeMetrics, type MetricResult } from '../math';
import { getActiveStudioStore, type StudioStore } from '../state/store';
import type { ComputationCacheSnapshot } from '../math/cache';

let nextJobId = 0;

export function useComputation(store: StudioStore = getActiveStudioStore(), disabled = false): void {
  const useStudioStore = store;
  const doc = useStudioStore((state) => state.doc);
  const paused = useStudioStore((state) => state.computationPaused);
  const arranging = useStudioStore((state) => state.relax3dRunning);
  const request = useStudioStore((state) => state.computationRequest);
  const cache = useRef(new Map<string, MetricResult>());
  const componentCache = useRef<ComputationCacheSnapshot>({ ollivier: [], effective: [] });
  const key = useMemo(() => computationKeyForDoc(doc), [doc]);

  useEffect(() => {
    if (disabled || paused || arranging) return;
    const state = useStudioStore.getState();
    const cached = cache.current.get(key) ?? (!state.computing && state.results?.key === key ? state.results : undefined);
    if (cached) {
      cache.current.delete(key);
      cache.current.set(key, cached);
      state.setResults(cached);
      return;
    }
    const vertices = [...doc.vertices.values()].map(({ id }) => ({ id }));
    const edges = [...doc.edges.values()];
    if (!edges.length) {
      state.setResults(computeMetrics(vertices, edges));
      return;
    }
    const jobId = ++nextJobId;
    let worker: Worker | undefined;
    let disposed = false;
    let release = () => {};
    let cancelQueue = () => {};
    const fail = (message: string) => {
      if (disposed) return;
      disposed = true;
      worker?.terminate(); release();
      useStudioStore.setState({ computing: false, computationError: message });
    };
    state.setComputing(true, 0);
    const timer = window.setTimeout(() => {
      cancelQueue = queueComputation(store, done => {
      release = done;
      try {
        worker = new Worker(new URL('../math/worker.ts', import.meta.url), { type: 'module' });
        worker.onerror = (event) => { event.preventDefault(); fail('Calculation could not finish. Retry, or reduce the graph size.'); };
        worker.onmessageerror = () => fail('The calculation returned unreadable data. Please retry.');
        worker.onmessage = (event: MessageEvent<WorkerOut>) => {
          if (disposed) return;
          const data = event.data;
          try { if (!acceptWorkerReply(data, jobId, key)) return; }
          catch (error) { fail(error instanceof Error ? error.message : 'Invalid calculation response'); return; }
          if (data.type === 'error') { fail(data.message ?? 'Calculation failed. Please retry.'); return; }
          if (data.type === 'progress') { state.setComputing(true, Math.max(0.2, data.fraction ?? 0)); return; }
          if ((data.type === 'ollivier' || data.type === 'result') && data.result?.key === key) {
            const result: MetricResult = { ...data.result, unitOf: new Map(data.result.unitOf), bondMap: new Map(data.result.bondMap) };
            const complete = data.type === 'result';
            state.setResults(result, complete);
            if (complete) {
              if (data.cache) componentCache.current = data.cache;
              cache.current.set(key, result);
              let retainedValues = [...cache.current.values()].reduce((count, value) => count + value.values.length, 0);
              while (cache.current.size > 20 || retainedValues > 6000) {
                const oldest = cache.current.keys().next().value!;
                retainedValues -= cache.current.get(oldest)!.values.length;
                cache.current.delete(oldest);
              }
              disposed = true;
              worker?.terminate(); release();
            }
          }
        };
        worker.postMessage(createComputeMessage(jobId, vertices, edges, componentCache.current));
      } catch { fail('Calculation worker is unavailable. Please retry or reload the app.'); }
      });
    }, 150);
    // Termination also cancels the synchronous transport phase, not just tail iteration.
    return () => { disposed = true; window.clearTimeout(timer); worker?.terminate(); cancelQueue(); };
  }, [store, key, paused, request, arranging, disabled]);
}
