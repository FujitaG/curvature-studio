import { serializeWorkspace } from './serialization';

self.onmessage = (event: MessageEvent) => {
  try { self.postMessage({ raw: serializeWorkspace(event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Could not serialize comparison' }); }
};
