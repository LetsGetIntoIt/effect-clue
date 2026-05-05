"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useTranslations } from "next-intl";
import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useState,
} from "react";

interface ConfirmOptions {
    readonly title?: string;
    readonly message: string;
    readonly confirmLabel?: string;
    readonly cancelLabel?: string;
    readonly destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm extends ConfirmOptions {
    readonly resolve: (v: boolean) => void;
}

/**
 * Replaces `window.confirm`. Renders a single Radix AlertDialog at the app
 * root; callers invoke `const ok = await confirm({ message: "..." })` and
 * get `true` / `false`. Styled, keyboard-accessible, usable on mobile
 * Safari (which renders `window.confirm` as an ugly native sheet that
 * steals focus and blocks event handlers).
 */
export function ConfirmProvider({ children }: { readonly children: ReactNode }) {
    const tCommon = useTranslations("common");
    const [pending, setPending] = useState<PendingConfirm | null>(null);

    const confirm = useCallback<ConfirmFn>((opts) => {
        return new Promise<boolean>((resolve) => {
            setPending({ ...opts, resolve });
        });
    }, []);

    const close = useCallback(
        (value: boolean) => {
            setPending((prev) => {
                if (prev) prev.resolve(value);
                return null;
            });
        },
        [],
    );

    const open = pending !== null;
    const confirmLabel =
        pending?.confirmLabel ?? tCommon("confirm");
    const cancelLabel = pending?.cancelLabel ?? tCommon("cancel");
    const destructive = pending?.destructive ?? true;

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            <AlertDialog.Root
                open={open}
                onOpenChange={(next) => {
                    if (!next) close(false);
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
                    >
                        {pending?.title ? (
                            <AlertDialog.Title className="m-0 mb-2 font-display text-[18px] text-accent">
                                {pending.title}
                            </AlertDialog.Title>
                        ) : (
                            <AlertDialog.Title className="sr-only">
                                {tCommon("confirmTitle")}
                            </AlertDialog.Title>
                        )}
                        <AlertDialog.Description className="m-0 text-[14px] leading-snug text-[#2a1f12]">
                            {pending?.message ?? ""}
                        </AlertDialog.Description>
                        <div className="mt-5 flex flex-wrap justify-end gap-2">
                            <AlertDialog.Cancel asChild>
                                <button
                                    type="button"
                                    className="cursor-pointer rounded-[var(--radius)] border border-border bg-transparent px-4 py-2 text-[13px] font-semibold text-[#2a1f12] hover:bg-hover"
                                >
                                    {cancelLabel}
                                </button>
                            </AlertDialog.Cancel>
                            <AlertDialog.Action asChild>
                                <button
                                    type="button"
                                    onClick={() => close(true)}
                                    className={
                                        "cursor-pointer rounded-[var(--radius)] border px-4 py-2 text-[13px] font-semibold " +
                                        (destructive
                                            ? "border-accent bg-accent text-white hover:bg-accent-hover"
                                            : "border-border bg-panel text-[#2a1f12] hover:bg-hover")
                                    }
                                >
                                    {confirmLabel}
                                </button>
                            </AlertDialog.Action>
                        </div>
                    </AlertDialog.Content>
                </AlertDialog.Portal>
            </AlertDialog.Root>
        </ConfirmContext.Provider>
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
