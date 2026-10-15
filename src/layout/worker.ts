import { createRelaxation, type LayoutInput, type LayoutMessage } from './relax3d';

const post = (message: LayoutMessage) => self.postMessage(message);
self.onmessage = async (event: MessageEvent<LayoutInput>) => {
  try {
    const runner = createRelaxation(event.data);
    let lastProgress = 0;
    while (!runner.done) {
      runner.stepUntil(performance.now() + 16);
      if (performance.now() - lastProgress > 80) {
        lastProgress = performance.now();
        post({ type: 'progress', progress: runner.progress });
      }
      // Yield between batches. Terminating this dedicated worker cancels all work.
      if (!runner.done) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    post({ type: 'result', positions: runner.result() });
  } catch {
    post({ type: 'error', message: '3D layout could not finish. Retry, or use a smaller graph.' });
  }
};
