import { getActiveStudioStore, type StudioStore } from '../state/store';
const instanceKeys = new WeakMap<StudioStore, number>();
let nextInstanceKey = 0;
/** Runtime ownership differs from the portable document ID (including on reopen). */
export function storeInstanceKey(store: StudioStore): number {
    let key = instanceKeys.get(store);
    if (key === undefined) { key = ++nextInstanceKey; instanceKeys.set(store, key); }
    return key;
}
const sizes = new WeakMap<StudioStore, {
    width: number;
    height: number;
}>();
export const rememberPaneSize = (store: StudioStore, element: HTMLElement) => { if (element.clientWidth && element.clientHeight)
    sizes.set(store, { width: element.clientWidth, height: element.clientHeight }); };
export const paneSize = (store: StudioStore) => sizes.get(store);
const measured = new WeakSet<StudioStore>();
export const markPaneMeasured = (store: StudioStore) => measured.add(store);
export const paneMeasured = (store: StudioStore) => measured.has(store);
const elements = new Map<StudioStore, HTMLElement>();
export const registerPane = (store: StudioStore, element: HTMLElement | null) => {
    measured.delete(store); if (element) {
    elements.set(store, element);
    rememberPaneSize(store, element);
}
else {
    const previous = elements.get(store);
    if (previous)
        rememberPaneSize(store, previous);
    elements.delete(store);
} };
export const paneElement = (store = getActiveStudioStore()) => elements.get(store);
export const eventForStore = (event: Event, store: StudioStore) => ((event as CustomEvent<{
    store?: StudioStore;
}>).detail?.store ?? getActiveStudioStore()) === store;
export const registeredStores = () => [...elements.keys()];
const pendingFits = new WeakSet<StudioStore>();
export const requestPaneFit = (store: StudioStore) => pendingFits.add(store);
export const consumePaneFit = (store: StudioStore) => { const pending = pendingFits.has(store); pendingFits.delete(store); return pending; };
