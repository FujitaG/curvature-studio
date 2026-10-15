import { computationKey } from './graph';
import { assertSupportedModel } from './model';
import { normalizeUnitEdge } from '../graph/edge';
import { CURRENT_CALCULATION, type CalculationDefinition } from './calculation';
import type { ComputationCacheSnapshot } from './cache';
import type { MathEdge, MathVertex, QuotientValue } from './types';

/** TODO(weighted-graphs): extend via a discriminated, versioned model; never
 * omit its definition or reuse unit cache entries when adding weighted jobs. */
export interface ComputeMessage {
  type: 'compute';
  jobId: number;
  model: 'finite-unit';
  inputKey: string;
  calculation: CalculationDefinition;
  vertices: MathVertex[];
  edges: MathEdge[];
  cache?: ComputationCacheSnapshot;
}
export interface SerializableResult {
  key: string;
  unitOf: Array<[number, number]>;
  quotientEdges: Array<[number, number]>;
  values: QuotientValue[];
  bondMap: Array<[number, number | 'intra']>;
}
export type WorkerOut =
  | { type: 'ollivier'; jobId: number; inputKey: string; result: SerializableResult }
  | { type: 'progress'; jobId: number; inputKey: string; fraction: number }
  | { type: 'result'; jobId: number; inputKey: string; result: SerializableResult; cache: ComputationCacheSnapshot }
  | { type: 'error'; jobId: number; inputKey: string; message: string };

export function createComputeMessage(jobId: number, vertices: MathVertex[], edges: MathEdge[], cache?: ComputationCacheSnapshot): ComputeMessage {
  // Do not silently strip a future semantic edge field (e.g. periodic shift).
  for (const edge of edges) fields(edge, ['id', 'a', 'b', 'kind'], ['weight'], 'edge');
  const structuralVertices = vertices.map(({ id }) => ({ id }));
  const structuralEdges = edges.map(normalizeUnitEdge);
  return {
    model: 'finite-unit', inputKey: computationKey(structuralVertices, structuralEdges),
    type: 'compute', jobId, calculation: { ...CURRENT_CALCULATION },
    vertices: structuralVertices, edges: structuralEdges,
    ...(cache ? { cache } : {})
  };
}

function fields(value: unknown, required: string[], optional: string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      required.some(key => !Object.prototype.hasOwnProperty.call(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new Error(`Unsupported calculation ${label} fields. No unknown semantics were ignored.`);
  }
}

/** Recompute at the Worker trust boundary before touching caches or a solver. */
export function validateComputeMessage(message: ComputeMessage): string {
  fields(message, ['type', 'jobId', 'model', 'inputKey', 'calculation', 'vertices', 'edges'], ['cache'], 'request');
  assertSupportedModel({ kind: message.model, calculation: message.calculation });
  if (!Number.isSafeInteger(message.jobId) || message.jobId < 1) throw new Error('Invalid calculation job identity');
  if (message.type !== 'compute' || typeof message.inputKey !== 'string' || !Array.isArray(message.vertices) || !Array.isArray(message.edges)) throw new Error('Invalid calculation request');
  const ids = new Set<number>(), edgeIds = new Set<number>();
  for (const vertex of message.vertices) {
    fields(vertex, ['id'], [], 'vertex');
    if (!Number.isSafeInteger(vertex.id) || ids.has(vertex.id)) throw new Error('Invalid calculation vertex identity');
    ids.add(vertex.id);
  }
  for (const edge of message.edges) {
    fields(edge, ['id', 'a', 'b', 'kind'], ['weight'], 'edge');
    if (!Number.isSafeInteger(edge.id) || edgeIds.has(edge.id) || !ids.has(edge.a) || !ids.has(edge.b) || edge.a === edge.b || !['bond', 'brace'].includes(edge.kind)) throw new Error('Invalid finite calculation edge');
    edgeIds.add(edge.id);
  }
  const key = computationKey(message.vertices, message.edges);
  if (key !== message.inputKey) throw new Error('Calculation input identity does not match its graph. Retry calculation.');
  return key;
}

/** Dedicated Worker per job: a different job ID on THIS worker is corruption.
 * The hook's disposed guard ignores replies from replaced/terminated workers.
 * TODO(worker-pool): multiplexed workers will need a separate dispatch policy.
 */
export function acceptWorkerReply(message: WorkerOut, jobId: number, inputKey: string): boolean {
  if (message.jobId !== jobId) throw new Error('Calculation returned an unexpected job identity. Retry calculation.');
  if (!['result', 'ollivier', 'progress', 'error'].includes(message.type)) throw new Error('Calculation returned an unsupported response. Retry calculation.');
  if (message.inputKey !== inputKey ||
      ((message.type === 'result' || message.type === 'ollivier') && message.result.key !== inputKey)) {
    throw new Error('Calculation returned results for a different input. Retry calculation.');
  }
  return true;
}
