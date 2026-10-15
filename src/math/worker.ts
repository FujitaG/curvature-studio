import { createEffectiveRunner } from './effective';
import { ComponentCache, type ComputationCacheSnapshot } from './cache';
import { computeOllivierCurvatures } from './ollivier';
import { buildQuotient } from './quotient';
import type { EffectiveValue, OllivierValue, QuotientValue } from './types';
import { validateComputeMessage } from './protocol';
import type { ComputeMessage, SerializableResult, WorkerOut } from './protocol';

let latestJobId = 0;

function post(message: WorkerOut): void {
  self.postMessage(message);
}

function serializeBase(
  key: string,
  quotient: ReturnType<typeof buildQuotient>,
  values: QuotientValue[]
): SerializableResult {
  return {
    key,
    unitOf: [...quotient.unitOf.entries()],
    quotientEdges: quotient.quotientEdges,
    values,
    bondMap: [...quotient.bondMap.entries()]
  };
}

async function runJob(message: ComputeMessage): Promise<void> {
  latestJobId = message.jobId;
  try {
    const key = validateComputeMessage(message);
    const quotient = buildQuotient(message.vertices, message.edges);
    const ollivierCache = new ComponentCache<OllivierValue>(message.cache?.ollivier);
    const effectiveCache = new ComponentCache<EffectiveValue>(message.cache?.effective);
    const snapshotCache = (): ComputationCacheSnapshot => ({ ollivier: ollivierCache.snapshot(), effective: effectiveCache.snapshot() });
    const ollivier = computeOllivierCurvatures(quotient.graph, ollivierCache);
    const partialValues: QuotientValue[] = quotient.quotientEdges.map((_, index) => ({
      ...ollivier[index],
      vInf: Number.NaN,
      kEff: Number.NaN,
      converged: false,
      iterations: 0
    }));
    post({ type: 'ollivier', jobId: message.jobId, inputKey: message.inputKey, result: serializeBase(key, quotient, partialValues) });

    if (message.jobId !== latestJobId) return;
    if (quotient.quotientEdges.length === 0) {
      post({ type: 'result', jobId: message.jobId, inputKey: message.inputKey, result: serializeBase(key, quotient, []), cache: snapshotCache() });
      return;
    }

    const runner = createEffectiveRunner(quotient.graph, undefined, effectiveCache);
    let lastProgress = 0;
    while (!runner.done) {
      if (message.jobId !== latestJobId) return;
      runner.stepUntil(performance.now() + 20);
      const now = performance.now();
      if (now - lastProgress > 80 || runner.done) {
        lastProgress = now;
        post({
          type: 'progress',
          jobId: message.jobId, inputKey: message.inputKey,
          fraction: quotient.quotientEdges.length === 0 ? 1 : runner.frozenCount / quotient.quotientEdges.length
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (message.jobId !== latestJobId) return;
    const effective = runner.results();
    const values: QuotientValue[] = quotient.quotientEdges.map((_, index) => ({
      ...ollivier[index],
      ...effective[index]
    }));
    post({ type: 'result', jobId: message.jobId, inputKey: message.inputKey, result: serializeBase(key, quotient, values), cache: snapshotCache() });
  } catch (error) {
    post({ type: 'error', jobId: message.jobId, inputKey: message.inputKey, message: error instanceof Error ? error.message : String(error) });
  }
}

self.onmessage = (event: MessageEvent<ComputeMessage>) => {
  if (event.data.type === 'compute') void runJob(event.data);
};
