import { HARD_CAP, TAIL_TOLERANCE } from './calculation';
export { HARD_CAP, TAIL_TOLERANCE } from './calculation';
import type { EffectiveValue, SimpleGraph } from './types';
import { ComponentCache } from './cache';
import { graphComponents } from './components';

export interface EffectiveRunner {
  done: boolean;
  frozenCount: number;
  iteration: number;
  readonly workingBytes: number;
  stepUntil(deadlineMs: number): void;
  results(): EffectiveValue[];
}


function stableRatios(ratios: number[]): boolean {
  if (ratios.length < 10) return false;
  const mean = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  if (mean <= 0) return false;
  const min = Math.min(...ratios);
  const max = Math.max(...ratios);
  return (max - min) / mean < 0.01;
}

function kEffFromVInf(vInf: number): number {
  const safe = Math.max(vInf, 2);
  const root = Math.sqrt(Math.max(0, 1 - 2 / safe));
  return (2 / safe) / (1 + root);
}

export const EFFECTIVE_BATCH_SIZE = 32;

// TODO(weighted-graphs): keep this unit kernel unchanged; implement conductance
// normalization and certified tails in future/weighted.ts, with the SAME row
// dipole orientation and iid equal-variance noise floor 2.
function createBatchRunner(graph: SimpleGraph, start: number, end: number, workspace: Float64Array, hardCap: number): EffectiveRunner {
  const edges = graph.edges.slice(start, end);
  const edgeCount = edges.length;
  workspace.fill(0);
  const vectors = edges.map(([a, b], index) => {
    const v = workspace.subarray(index * graph.vertexCount, (index + 1) * graph.vertexCount);
    v[a] = 1;
    v[b] = -1;
    return v;
  });
  const next = workspace.subarray(workspace.length - graph.vertexCount);
  const totals = new Float64Array(edgeCount);
  const previous = new Float64Array(edgeCount);
  const iterations = new Int32Array(edgeCount);
  const converged = new Array<boolean>(edgeCount).fill(false);
  const frozen = new Array<boolean>(edgeCount).fill(false);
  const ratioWindows: number[][] = Array.from({ length: edgeCount }, () => []);
  totals.fill(2);
  previous.fill(2);

  const runner: EffectiveRunner = {
    done: edgeCount === 0,
    frozenCount: 0,
    workingBytes: workspace.byteLength,
    iteration: 0,
    stepUntil(deadlineMs: number): void {
      while (!runner.done && performance.now() < deadlineMs) {
        runner.iteration += 1;
        for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
          if (frozen[edgeIndex]) continue;
          const v = vectors[edgeIndex];

          for (let u = 0; u < graph.vertexCount; u += 1) {
            let value = 0.5 * v[u];
            for (const w of graph.adjacency[u]) {
              const degree = graph.degree[w];
              if (degree > 0) value += 0.5 * (v[w] / degree);
            }
            next[u] = value;
          }

          let increment = 0;
          for (let u = 0; u < graph.vertexCount; u += 1) {
            const value = next[u];
            increment += value * value;
            v[u] = value;
          }
          totals[edgeIndex] += increment;
          iterations[edgeIndex] = runner.iteration;

          const prev = previous[edgeIndex];
          const ratios = ratioWindows[edgeIndex];
          if (increment > prev * (1 + 1e-10)) {
            ratios.length = 0;
          } else if (prev > 0) {
            const rho = increment / prev;
            ratios.push(rho);
            if (ratios.length > 10) ratios.shift();
            if (
              runner.iteration >= 50 &&
              rho < 1 &&
              stableRatios(ratios) &&
              increment * rho / Math.max(1e-300, 1 - rho) < TAIL_TOLERANCE
            ) {
              frozen[edgeIndex] = true;
              converged[edgeIndex] = true;
              runner.frozenCount += 1;
            }
          } else if (runner.iteration >= 50) {
            frozen[edgeIndex] = true;
            converged[edgeIndex] = true;
            runner.frozenCount += 1;
          }
          previous[edgeIndex] = increment;

          if (!frozen[edgeIndex] && runner.iteration >= hardCap) {
            frozen[edgeIndex] = true;
            converged[edgeIndex] = false;
            runner.frozenCount += 1;
          }
        }
        runner.done = runner.frozenCount === edgeCount || runner.iteration >= hardCap;
        if (runner.iteration >= hardCap && !runner.done) {
          for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
            if (frozen[edgeIndex]) continue;
            frozen[edgeIndex] = true;
            converged[edgeIndex] = false;
            runner.frozenCount += 1;
          }
          runner.done = true;
        }
      }
    },
    results(): EffectiveValue[] {
      return edges.map((_, index) => {
        const vInf = totals[index];
        return {
          vInf,
          kEff: kEffFromVInf(vInf),
          converged: converged[index],
          iterations: iterations[index]
        };
      });
    }
  };

  return runner;
}

/** Independent components and bounded batches retain the original per-edge arithmetic. */
export function createEffectiveRunner(graph: SimpleGraph, hardCap = HARD_CAP, cache = new ComponentCache<EffectiveValue>()): EffectiveRunner {
  const components = graphComponents(graph);
  const values: EffectiveValue[] = graph.edges.map(() => ({ vInf: 2, kEff: 1, converged: false, iterations: 0 }));
  let componentIndex = 0;
  let offset = 0;
  let completed = 0;
  let workspace: Float64Array | null = null;
  let batch: EffectiveRunner | null = null;
  let componentValues: EffectiveValue[] = [];
  const runner: EffectiveRunner = {
    done: components.length === 0,
    frozenCount: 0,
    iteration: 0,
    get workingBytes() { return workspace?.byteLength ?? 0; },
    stepUntil(deadlineMs) {
      while (!runner.done && performance.now() < deadlineMs) {
        const component = components[componentIndex];
        const key = `${hardCap}:${component.key}`;
        if (!workspace) {
          const cached = cache.get(key);
          if (cached) {
            component.edgeIndices.forEach((index, local) => { values[index] = cached[local]; });
            completed += cached.length;
            runner.frozenCount = completed;
            runner.iteration = Math.max(runner.iteration, ...cached.map(value => value.iterations));
            componentIndex += 1;
            runner.done = componentIndex === components.length;
            continue;
          }
          // One buffer for up to 32 dipoles plus one shared transition scratch row.
          workspace = new Float64Array((Math.min(EFFECTIVE_BATCH_SIZE, component.graph.edges.length) + 1) * component.graph.vertexCount);
          componentValues = [];
          offset = 0;
        }
        const end = Math.min(offset + EFFECTIVE_BATCH_SIZE, component.graph.edges.length);
        batch ??= createBatchRunner(component.graph, offset, end, workspace, hardCap);
        batch.stepUntil(deadlineMs);
        runner.iteration = Math.max(runner.iteration, batch.iteration);
        runner.frozenCount = completed + batch.frozenCount;
        if (!batch.done) return;
        const finished = batch.results();
        finished.forEach((value, index) => { values[component.edgeIndices[offset + index]] = value; });
        componentValues.push(...finished);
        completed += finished.length;
        offset = end;
        batch = null;
        if (offset === component.graph.edges.length) {
          cache.set(key, componentValues);
          componentIndex += 1;
          workspace = null;
          componentValues = [];
          runner.done = componentIndex === components.length;
        }
      }
    },
    results() {
      if (batch) {
        const component = components[componentIndex];
        batch.results().forEach((value, index) => { values[component.edgeIndices[offset + index]] = value; });
      }
      return values.slice();
    }
  };
  return runner;
}

export function computeEffectiveCurvatures(graph: SimpleGraph, hardCap = HARD_CAP): EffectiveValue[] {
  const runner = createEffectiveRunner(graph, hardCap);
  while (!runner.done) runner.stepUntil(Number.POSITIVE_INFINITY);
  return runner.results();
}
