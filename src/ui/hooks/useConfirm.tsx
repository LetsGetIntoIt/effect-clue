/**
 * Promise-based confirm dialog. Replaces `window.confirm` with a
 * styled, keyboard-accessible modal pushed onto the global modal stack
 * so it composes cleanly with whatever else is open.
 *
 * Callers do `const ok = await confirm({ message: "..." })`. The
 * promise resolves true on Confirm, false on Cancel. Outside-click and
 * Escape are disabled (must go through a button) — matches the strict
 * dismissal of the prior `AlertDialog`-based implementation.
 */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useRef,
} from "react";
import { useModalStack } from "../components/ModalStack";

interface ConfirmOptions {
    readonly title?: string;
    readonly message: string;
    readonly confirmLabel?: string;
    readonly cancelLabel?: string;
    readonly destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

const CONFIRM_ID_PREFIX = "confirm" as const;

export function ConfirmProvider({ children }: { readonly children: ReactNode }) {
    const tCommon = useTranslations("common");
    const { push, pop } = useModalStack();
    // Monotonic counter so each confirm() call gets a unique stack id.
    // Lets the same provider serve multiple back-to-back confirms
    // without id collisions.
    const nextIdRef = useRef(0);

    const confirm = useCallback<ConfirmFn>(
        (opts) => {
            return new Promise<boolean>((resolve) => {
                nextIdRef.current += 1;
                const id = `${CONFIRM_ID_PREFIX}-${nextIdRef.current}`;
                const settle = (value: boolean) => {
                    // Resolve FIRST. See usePrompt's `settle` for the
                    // same reasoning — `pop()` synchronously fires the
                    // safety-net `onClose` that resolves `false`, and
                    // promises only resolve once.
                    resolve(value);
                    pop();
                };
                push({
                    id,
                    title: opts.title ?? tCommon("confirmTitle"),
                    dismissOnOutsideClick: false,
                    dismissOnEscape: false,
                    maxWidth: "min(90vw,420px)",
                    // Defensive resolve(false) — if the entry is removed
                    // by closeAll/popTo from outside, the awaited
                    // promise still settles. The user-driven settle()
                    // path resolves first; this onClose's resolve(false)
                    // is then a no-op (Promise resolves once).
                    onClose: () => resolve(false),
                    content: (
                        <ConfirmModalContent
                            options={opts}
                            onResolve={settle}
                            confirmTitle={tCommon("confirmTitle")}
                            defaultConfirmLabel={tCommon("confirm")}
                            defaultCancelLabel={tCommon("cancel")}
                        />
                    ),
                });
            });
        },
        [push, pop, tCommon],
    );

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
        </ConfirmContext.Provider>
    );
}

function ConfirmModalContent({
    options,
    onResolve,
    confirmTitle,
    defaultConfirmLabel,
    defaultCancelLabel,
}: {
    readonly options: ConfirmOptions;
    readonly onResolve: (value: boolean) => void;
    readonly confirmTitle: string;
    readonly defaultConfirmLabel: string;
    readonly defaultCancelLabel: string;
}) {
    const confirmLabel = options.confirmLabel ?? defaultConfirmLabel;
    const cancelLabel = options.cancelLabel ?? defaultCancelLabel;
    const destructive = options.destructive ?? true;
    const visibleTitle = options.title ?? null;
    return (
        <div className="p-5">
            {visibleTitle ? (
                <Dialog.Title className="m-0 mb-2 font-display text-[1.125rem] text-accent">
                    {visibleTitle}
                </Dialog.Title>
            ) : (
                <Dialog.Title className="sr-only">
                    {confirmTitle}
                </Dialog.Title>
            )}
            <p className="m-0 text-[1rem] leading-snug text-[#2a1f12]">
                {options.message}
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                    type="button"
                    onClick={() => onResolve(false)}
                    className="tap-target text-tap cursor-pointer rounded-[var(--radius)] border border-border bg-transparent font-semibold text-[#2a1f12] hover:bg-hover"
                >
                    {cancelLabel}
                </button>
                <button
                    type="button"
                    onClick={() => onResolve(true)}
                    className={
                        "tap-target text-tap cursor-pointer rounded-[var(--radius)] border font-semibold " +
                        (destructive
                            ? "border-accent bg-accent text-white hover:bg-accent-hover"
                            : "border-border bg-panel text-[#2a1f12] hover:bg-hover")
                    }
                >
                    {confirmLabel}
                </button>
            </div>
        </div>
    );
}

export function useConfirm(): ConfirmFn {
    const ctx = useContext(ConfirmContext);
    if (!ctx) {
        throw new Error(
            // eslint-disable-next-line i18next/no-literal-string
            "useConfirm must be used inside <ConfirmProvider>",
        );
    }
    return ctx;
}
