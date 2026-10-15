import { useSyncExternalStore } from 'react';
import type { StoreApi, UseBoundStore } from 'zustand';

/** Shared chrome follows the selected document; canvases receive concrete stores. */
export function activeStore<T>(initial: UseBoundStore<StoreApi<T>>) {
  let current = initial;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const get = () => current;
  const hook = (<U,>(selector: (state: T) => U) => {
    const store = useSyncExternalStore(subscribe, get);
    return store(selector);
  }) as UseBoundStore<StoreApi<T>>;
  hook.getState = () => current.getState();
  hook.getInitialState = () => current.getInitialState();
  hook.setState = ((...args: Parameters<StoreApi<T>['setState']>) => current.setState(...args)) as StoreApi<T>['setState'];
  hook.subscribe = listener => {
    let stop = current.subscribe(listener);
    const off = subscribe(() => { stop(); stop = current.subscribe(listener); });
    return () => { stop(); off(); };
  };
  return { hook, get, select: (next: typeof current) => { if (next !== current) { current = next; listeners.forEach(fn => fn()); } } };
}
