/**
 * Promise-based labeled-input dialog. Mirrors `useConfirm` but resolves
 * to a trimmed string (or `null` if the user cancels). Cancel resolves
 * `null`; outside-click and Escape are blocked so a half-typed value
 * isn't lost to a stray click. The previous text is auto-selected on
 * open so a re-edit is one keystroke away. The Save button is disabled
 * while the trimmed input is empty, so a successful submit always
 * yields a non-empty string.
 */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useRef,
} from "react";
import { useModalStack } from "../components/ModalStack";
import {
    createModalSlotStore,
    type ModalSlotStore,
    useModalSlotStoreSelector,
} from "../components/modalSlotStore";

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

const PROMPT_ID_PREFIX = "prompt" as const;

export function PromptProvider({ children }: { readonly children: ReactNode }) {
    const tCommon = useTranslations("common");
    const { push, pop } = useModalStack();
    const nextIdRef = useRef(0);

    const prompt = useCallback<PromptFn>(
        (opts) => {
            return new Promise<string | null>((resolve) => {
                nextIdRef.current += 1;
                const id = `${PROMPT_ID_PREFIX}-${nextIdRef.current}`;
                // Shared subscribable store across the content (input)
                // and footer (Save / Cancel buttons) slots. The
                // content updates it on every keystroke; the footer
                // reads it via `useSyncExternalStore` so the Save
                // button's disabled state stays in sync.
                const store = createModalSlotStore({
                    value: opts.initialValue ?? "",
                });
                const settle = (value: string | null) => {
                    // Resolve FIRST. `pop()` synchronously fires this
                    // entry's `onClose`, which calls `resolve(null)` as
                    // its safety-net for external pop / closeAll. If
                    // we popped first, that safety-net would race ahead
                    // of the user's actual choice — promises only
                    // resolve once, so the second `resolve(value)`
                    // would no-op and the caller would see `null` for
                    // a successful Save.
                    resolve(value);
                    pop();
                };
                push({
                    id,
                    title: opts.title,
                    dismissOnOutsideClick: false,
                    dismissOnEscape: false,
                    maxWidth: "min(90vw,420px)",
                    onClose: () => resolve(null),
                    header: (
                        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
                            <Dialog.Title className="m-0 font-display text-[1.25rem] text-accent">
                                {opts.title}
                            </Dialog.Title>
                        </div>
                    ),
                    content: (
                        <PromptModalContent
                            options={opts}
                            store={store}
                            onSubmit={() => {
                                const trimmed = store.get().value.trim();
                                if (trimmed.length > 0) settle(trimmed);
                            }}
                        />
                    ),
                    footer: (
                        <PromptModalFooter
                            options={opts}
                            store={store}
                            onCancel={() => settle(null)}
                            onConfirm={() => {
                                const trimmed = store.get().value.trim();
                                if (trimmed.length > 0) settle(trimmed);
                            }}
                            defaultConfirmLabel={tCommon("save")}
                            defaultCancelLabel={tCommon("cancel")}
                        />
                    ),
                });
            });
        },
        [push, pop, tCommon],
    );

    return (
        <PromptContext.Provider value={prompt}>
            {children}
        </PromptContext.Provider>
    );
}

interface PromptStoreState {
    readonly value: string;
}

function PromptModalContent({
    options,
    store,
    onSubmit,
}: {
    readonly options: PromptOptions;
    readonly store: ModalSlotStore<PromptStoreState>;
    readonly onSubmit: () => void;
}) {
    const value = useModalSlotStoreSelector(store, (s) => s.value);
    const inputRef = useRef<HTMLInputElement | null>(null);

    // Auto-focus + select on mount. Single rAF lets the modal's slide
    // animation start before we steal focus, so the cursor doesn't
    // jump mid-transition.
    useEffect(() => {
        const id = window.requestAnimationFrame(() => {
            const el = inputRef.current;
            if (!el) return;
            el.focus();
            el.select();
        });
        return () => window.cancelAnimationFrame(id);
    }, []);

    return (
        <div className="px-5 pt-3 pb-3">
            <p className="sr-only">{options.label}</p>
            <label className="m-0 block text-[1rem] font-semibold text-[#2a1f12]">
                {options.label}
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) =>
                        store.set(() => ({ value: e.target.value }))
                    }
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            onSubmit();
                        }
                    }}
                    placeholder={options.placeholder}
                    maxLength={options.maxLength}
                    className="tap-target text-tap mt-1 block w-full rounded-[var(--radius)] border border-border bg-white text-[#2a1f12] focus:border-accent focus:outline-none"
                />
            </label>
        </div>
    );
}

function PromptModalFooter({
    options,
    store,
    onCancel,
    onConfirm,
    defaultConfirmLabel,
    defaultCancelLabel,
}: {
    readonly options: PromptOptions;
    readonly store: ModalSlotStore<PromptStoreState>;
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
    readonly defaultConfirmLabel: string;
    readonly defaultCancelLabel: string;
}) {
    const canSubmit = useModalSlotStoreSelector(
        store,
        (s) => s.value.trim().length > 0,
    );
    const confirmLabel = options.confirmLabel ?? defaultConfirmLabel;
    const cancelLabel = options.cancelLabel ?? defaultCancelLabel;

    return (
        <div className="flex flex-wrap items-center justify-end gap-2 bg-panel px-5 pt-4 pb-5">
            <button
                type="button"
                onClick={onCancel}
                className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border border-border bg-transparent font-semibold text-[#2a1f12] hover:bg-hover"
            >
                {cancelLabel}
            </button>
            <button
                type="button"
                onClick={onConfirm}
                disabled={!canSubmit}
                className={
                    "tap-target text-tap cursor-pointer rounded-[var(--radius)] border-2 border-accent bg-accent font-semibold text-white hover:bg-accent-hover " +
                    "disabled:cursor-not-allowed disabled:border-border disabled:bg-row-alt disabled:text-muted disabled:hover:bg-row-alt"
                }
            >
                {confirmLabel}
            </button>
        </div>
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
