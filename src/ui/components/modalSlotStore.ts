/**
 * Tiny subscribable store for sharing state across modal slots
 * (`header` / `content` / `footer`).
 *
 * Why this exists: `ModalStack` renders the three slots as siblings.
 * State that lives in one slot (e.g. an `<input>` value in the
 * `content` slot) often needs to drive UI in another slot (e.g.
 * enabling the Save button in the `footer` slot). React Context
 * doesn't work cleanly here — each slot would need to wrap itself
 * in a Provider, and Providers in sibling subtrees don't share
 * state. A store created in the opener's closure does: each slot
 * subscribes to the SAME store reference and re-renders on change.
 *
 * Usage:
 *   const store = createModalSlotStore({ value: "" });
 *   push({
 *     content: <Body store={store} />,
 *     footer: <Footer store={store} />,
 *   });
 *   // Inside Body / Footer:
 *   const value = useModalSlotStoreSelector(store, (s) => s.value);
 *   store.set((s) => ({ ...s, value: "hello" }));
 */
import { useSyncExternalStore } from "react";

export interface ModalSlotStore<T> {
    readonly get: () => T;
    readonly set: (updater: (current: T) => T) => void;
    readonly subscribe: (listener: () => void) => () => void;
}

export function createModalSlotStore<T>(initial: T): ModalSlotStore<T> {
    let state = initial;
    const listeners = new Set<() => void>();
    return {
        get: () => state,
        set: (updater) => {
            state = updater(state);
            listeners.forEach((fn) => fn());
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

export function useModalSlotStoreSelector<T, S>(
    store: ModalSlotStore<T>,
    selector: (s: T) => S,
): S {
    return useSyncExternalStore(
        store.subscribe,
        () => selector(store.get()),
        () => selector(store.get()),
    );
}
