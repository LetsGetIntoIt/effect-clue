"use client";

import {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useRef,
    type ReactNode,
} from "react";
import type { WizardStepId } from "./wizardSteps";

/**
 * One-shot focus hint for the wizard. M7's `<SetupSummary>` will set
 * a step id before dispatching `setUiMode("setup")`; the wizard reads
 * it on mount, scrolls to (and expands) that panel, and clears the
 * hint so a re-render doesn't re-fire focus.
 *
 * The hint lives in a ref to avoid render churn — the only consumer
 * is the wizard's mount effect, which reads-and-clears once.
 */
interface FocusContextValue {
    readonly setFocusOnNextMount: (stepId: WizardStepId) => void;
    readonly consumeFocusHint: () => WizardStepId | null;
}

const Context = createContext<FocusContextValue | null>(null);

export function SetupWizardFocusProvider({
    children,
}: {
    readonly children: ReactNode;
}) {
    const hintRef = useRef<WizardStepId | null>(null);

    const setFocusOnNextMount = useCallback((stepId: WizardStepId) => {
        hintRef.current = stepId;
    }, []);

    const consumeFocusHint = useCallback((): WizardStepId | null => {
        const hint = hintRef.current;
        hintRef.current = null;
        return hint;
    }, []);

    const value = useMemo(
        () => ({ setFocusOnNextMount, consumeFocusHint }),
        [setFocusOnNextMount, consumeFocusHint],
    );

    return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * Hook for setting the focus hint from outside the wizard. The
 * wizard itself uses `useWizardConsumeFocusHint` so the read-and-clear
 * is type-distinct.
 *
 * Returns null when the wizard provider isn't mounted (e.g. the
 * legacy Checklist setup path, with the wizard feature flag off).
 * Callers should fall back to a plain `dispatch({type: "setUiMode"})`
 * in that case.
 */
export function useSetupWizardFocus(): FocusContextValue | null {
    return useContext(Context);
}
