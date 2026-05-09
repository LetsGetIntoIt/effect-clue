"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useTranslations } from "next-intl";
import {
    createContext,
    type FormEvent,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";

interface PromptOptions {
    readonly title: string;
    readonly label: string;
    readonly initialValue?: string;
    readonly placeholder?: string;
    readonly confirmLabel?: string;
    readonly cancelLabel?: string;
    readonly maxLength?: number;
}

type PromptFn = (opts: PromptOptions) => Promise<string | null>;

const PromptContext = createContext<PromptFn | null>(null);

interface PendingPrompt extends PromptOptions {
    readonly resolve: (v: string | null) => void;
}

/**
 * Promise-based labeled-input dialog. Mirrors `useConfirm` but resolves
 * to a trimmed string (or `null` if the user cancels). Cancel / Esc /
 * overlay click resolve `null`; the Save button is disabled while the
 * input is empty after trim, so submitting always returns a non-empty
 * string. The previous text is auto-selected on open so a re-edit is
 * one keystroke away.
 */
export function PromptProvider({ children }: { readonly children: ReactNode }) {
    const tCommon = useTranslations("common");
    const [pending, setPending] = useState<PendingPrompt | null>(null);
    const [value, setValue] = useState("");
    const inputRef = useRef<HTMLInputElement | null>(null);

    const prompt = useCallback<PromptFn>((opts) => {
        return new Promise<string | null>((resolve) => {
            setPending({ ...opts, resolve });
        });
    }, []);

    useEffect(() => {
        if (pending) setValue(pending.initialValue ?? "");
    }, [pending]);

    const close = useCallback(
        (next: string | null) => {
            setPending((prev) => {
                if (prev) prev.resolve(next);
                return null;
            });
        },
        [],
    );

    const trimmed = value.trim();
    const canSubmit = trimmed.length > 0;
    const open = pending !== null;
    const confirmLabel = pending?.confirmLabel ?? tCommon("save");
    const cancelLabel = pending?.cancelLabel ?? tCommon("cancel");

    const handleSubmit = useCallback(
        (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (!canSubmit) return;
            close(trimmed);
        },
        [canSubmit, close, trimmed],
    );

    return (
        <PromptContext.Provider value={prompt}>
            {children}
            <AlertDialog.Root
                open={open}
                onOpenChange={(next) => {
                    if (!next) close(null);
                }}
            >
                <AlertDialog.Portal>
                    <AlertDialog.Overlay
                        className="fixed inset-0 z-[var(--z-dialog-overlay)] bg-black/30"
                    />
                    <AlertDialog.Content
                        className={
                            "fixed left-1/2 top-1/2 z-[var(--z-dialog-content)] w-[min(90vw,420px)] -translate-x-1/2 -translate-y-1/2 " +
                            "rounded-[var(--radius)] border border-border bg-panel p-5 shadow-[0_10px_28px_rgba(0,0,0,0.28)] " +
                            "focus:outline-none"
                        }
                        onOpenAutoFocus={(event) => {
                            event.preventDefault();
                            const input = inputRef.current;
                            if (!input) return;
                            input.focus();
                            input.select();
                        }}
                    >
                        <AlertDialog.Title className="m-0 mb-2 font-display text-[18px] text-accent">
                            {pending?.title ?? ""}
                        </AlertDialog.Title>
                        <AlertDialog.Description className="sr-only">
                            {pending?.label ?? ""}
                        </AlertDialog.Description>
                        <form onSubmit={handleSubmit}>
                            <label className="m-0 block text-[13px] font-semibold text-[#2a1f12]">
                                {pending?.label ?? ""}
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={value}
                                    onChange={(e) => setValue(e.target.value)}
                                    placeholder={pending?.placeholder}
                                    maxLength={pending?.maxLength}
                                    className="tap-target text-tap mt-1 block w-full rounded-[var(--radius)] border border-border bg-white text-[#2a1f12] focus:border-accent focus:outline-none"
                                />
                            </label>
                            <div className="mt-5 flex flex-wrap justify-end gap-2">
                                <AlertDialog.Cancel asChild>
                                    <button
                                        type="button"
                                        className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border border-border bg-transparent font-semibold text-[#2a1f12] hover:bg-hover"
                                    >
                                        {cancelLabel}
                                    </button>
                                </AlertDialog.Cancel>
                                <button
                                    type="submit"
                                    disabled={!canSubmit}
                                    className={
                                        "tap-target text-tap cursor-pointer rounded-[var(--radius)] border border-accent bg-accent font-semibold text-white hover:bg-accent-hover " +
                                        "disabled:cursor-not-allowed disabled:border-border disabled:bg-row-alt disabled:text-muted disabled:hover:bg-row-alt"
                                    }
                                >
                                    {confirmLabel}
                                </button>
                            </div>
                        </form>
                    </AlertDialog.Content>
                </AlertDialog.Portal>
            </AlertDialog.Root>
        </PromptContext.Provider>
    );
}

export function usePrompt(): PromptFn {
    const ctx = useContext(PromptContext);
    if (!ctx) {
        throw new Error(
            // eslint-disable-next-line i18next/no-literal-string
            "usePrompt must be used inside <PromptProvider>",
        );
    }
    return ctx;
}
