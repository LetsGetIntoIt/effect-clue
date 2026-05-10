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
    type FormEvent,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";
import { useModalStack } from "../components/ModalStack";

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
                    content: (
                        <PromptModalContent
                            options={opts}
                            onResolve={settle}
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

function PromptModalContent({
    options,
    onResolve,
    defaultConfirmLabel,
    defaultCancelLabel,
}: {
    readonly options: PromptOptions;
    readonly onResolve: (value: string | null) => void;
    readonly defaultConfirmLabel: string;
    readonly defaultCancelLabel: string;
}) {
    const [value, setValue] = useState(options.initialValue ?? "");
    const inputRef = useRef<HTMLInputElement | null>(null);

    // Auto-focus + select on mount. Single rAF lets the modal's slide
    // animation start before we steal focus, so the cursor doesn't
    // jump mid-transition. No retry timer needed since the content
    // mounts inside the already-open shell — Radix's FocusScope
    // doesn't fight us here the way it did when each modal owned its
    // own Dialog.Root.
    useEffect(() => {
        const id = window.requestAnimationFrame(() => {
            const el = inputRef.current;
            if (!el) return;
            el.focus();
            el.select();
        });
        return () => window.cancelAnimationFrame(id);
    }, []);

    const trimmed = value.trim();
    const canSubmit = trimmed.length > 0;
    const confirmLabel = options.confirmLabel ?? defaultConfirmLabel;
    const cancelLabel = options.cancelLabel ?? defaultCancelLabel;

    const handleSubmit = useCallback(
        (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (!canSubmit) return;
            onResolve(trimmed);
        },
        [canSubmit, onResolve, trimmed],
    );

    return (
        <div className="p-5">
            <Dialog.Title className="m-0 mb-2 font-display text-[18px] text-accent">
                {options.title}
            </Dialog.Title>
            <p className="sr-only">{options.label}</p>
            <form onSubmit={handleSubmit}>
                <label className="m-0 block text-[13px] font-semibold text-[#2a1f12]">
                    {options.label}
                    <input
                        ref={inputRef}
                        type="text"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={options.placeholder}
                        maxLength={options.maxLength}
                        className="tap-target text-tap mt-1 block w-full rounded-[var(--radius)] border border-border bg-white text-[#2a1f12] focus:border-accent focus:outline-none"
                    />
                </label>
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <button
                        type="button"
                        onClick={() => onResolve(null)}
                        className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border border-border bg-transparent font-semibold text-[#2a1f12] hover:bg-hover"
                    >
                        {cancelLabel}
                    </button>
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
