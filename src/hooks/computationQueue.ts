import { getActiveStudioStore, type StudioStore } from '../state/store';
interface Job {
    store: StudioStore;
    run: (done: () => void) => void;
    canceled: boolean;
    finish: () => void;
}
const waiting: Job[] = [];
let running: Job | null = null;
function pump() { if (running)
    return; const active = waiting.findIndex(j => j.store === getActiveStudioStore()); const next = waiting.splice(active < 0 ? 0 : active, 1)[0]; if (!next)
    return; if (next.canceled) {
    pump();
    return;
} running = next; next.finish = () => { if (running === next) {
    running = null;
    queueMicrotask(pump);
} }; next.run(next.finish); }
export function queueComputation(store: StudioStore, run: Job['run']) { const job: Job = { store, run, canceled: false, finish: () => { } }; waiting.push(job); pump(); return () => { job.canceled = true; const index = waiting.indexOf(job); if (index >= 0)
    waiting.splice(index, 1); job.finish(); }; }
