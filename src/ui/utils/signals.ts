import { type Signal, signal } from "@preact/signals"

export const signalToInput = <T>(signal: Signal<T>): { value: T, onChange: (newValue: T) => void } =>
    ({
        value: signal.value,
        onChange: (newValue) => signal.value = newValue,
    });
