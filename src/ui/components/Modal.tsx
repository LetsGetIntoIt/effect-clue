/**
 * Shared modal chrome — three-band (header / content / footer)
 * layout with sticky-offset CSS-variable reset and Radix Dialog
 * wiring. Two public surfaces:
 *
 * - `Modal`: static three-band modal. Use directly on a route page
 *   when the modal IS the page, or in a parent that controls `open`
 *   with `useState`. The simplest entry point — no provider needed.
 *
 * - `useModalStack().push({...})` (in `ModalStack.tsx`): dynamic
 *   stack of modals. Pushes onto a global stack so an inner modal
 *   can open another modal. The stack's shell renders through the
 *   same `ModalChrome` + `ModalBands` building blocks below so the
 *   visual chrome is identical regardless of static or dynamic
 *   usage.
 *
 * Both surfaces share the sticky-offset reset on the scrolling body,
 * so any embedded sticky `<thead>` (e.g. `CardSelectionGrid`'s
 * player-name row) pins to the modal's scroll-container top instead
 * of where the page header would otherwise sit.
 */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode } from "react";

const DEFAULT_MAX_WIDTH = "min(92vw,480px)" as const;
const ROLE_ALERT_DIALOG = "alertdialog" as const;

export interface ModalChromeProps {
    /** Whether the modal is open. */
    readonly open: boolean;
    /** Accessible label fallback when the body doesn't render a
     *  visible `Dialog.Title`. The visible title lives inside the
     *  `header` band. */
    readonly title?: string;
    /** CSS width — defaults to `min(92vw,480px)`. Height always
     *  auto-fits to content up to the viewport. */
    readonly maxWidth?: string;
    /** Backdrop click dismisses (default true). Set false for
     *  confirm-style modals where dismissal must go through an
     *  explicit button. */
    readonly dismissOnOutsideClick?: boolean;
    /** Escape dismisses (default true). Pair with
     *  `dismissOnOutsideClick: false` for confirm-style modals. */
    readonly dismissOnEscape?: boolean;
    /** Radix `onOpenChange` — fired on backdrop click or Escape
     *  (when not opted out above). The caller decides what "close"
     *  means (navigate away, set local state, pop a stack). */
    readonly onOpenChange?: (next: boolean) => void;
    /** Children replace the entire `Dialog.Content` body. Use
     *  `ModalBands` to render the standard three-band layout
     *  inside. */
    readonly children: ReactNode;
}

/**
 * Outer Radix Dialog wrapper with the modal's chrome styling.
 * `Modal` (static) and `ModalStack`'s shell (dynamic) both render
 * through this so the outer chrome is identical across both
 * surfaces.
 */
export function ModalChrome({
    open,
    title,
    maxWidth = DEFAULT_MAX_WIDTH,
    dismissOnOutsideClick,
    dismissOnEscape,
    onOpenChange,
    children,
}: ModalChromeProps) {
    const isAlert =
        dismissOnOutsideClick === false || dismissOnEscape === false;
    return (
        <Dialog.Root
            open={open}
            {...(onOpenChange !== undefined ? { onOpenChange } : {})}
        >
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-[var(--z-dialog-overlay)] bg-black/40" />
                <Dialog.Content
                    onEscapeKeyDown={(e) => {
                        if (dismissOnEscape === false) e.preventDefault();
                    }}
                    onPointerDownOutside={(e) => {
                        if (dismissOnOutsideClick === false) e.preventDefault();
                    }}
                    style={{ width: maxWidth }}
                    className={
                        "fixed left-1/2 top-1/2 z-[var(--z-dialog-content)] " +
                        "max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 " +
                        "overflow-hidden rounded-[var(--radius)] border border-border " +
                        "bg-panel shadow-[0_10px_28px_rgba(0,0,0,0.28)] focus:outline-none"
                    }
                    aria-describedby={undefined}
                    {...(isAlert ? { role: ROLE_ALERT_DIALOG } : {})}
                    aria-label={title}
                >
                    {children}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

export interface ModalBandsProps {
    /** Optional pinned header band — title + close X, etc. */
    readonly header?: ReactNode;
    /** Scrollable body. Sticky descendants (`CardSelectionGrid`'s
     *  `<thead>`) pin at the top of THIS scroll container. */
    readonly content: ReactNode;
    /** Optional pinned footer band — action buttons. */
    readonly footer?: ReactNode;
}

/**
 * The three-band layout: pinned header, scrollable body, pinned
 * footer. The body resets `--header-offset` /
 * `--contradiction-banner-offset` to `0px` so embedded sticky
 * elements pin at the modal's scroll-container top instead of the
 * page-header offset their `top:` calc normally inherits.
 *
 * `z-[40]` on the header and footer wins against any z-index inside
 * `content` up through 39 (the checklist-style grid's sticky-header
 * layer tops out there). `relative z-0` on the body wraps content in
 * its own stacking context so its high-z descendants can't paint
 * over the bands.
 */
export function ModalBands({ header, content, footer }: ModalBandsProps) {
    return (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
            {header !== undefined && (
                <div className="relative z-[40] shrink-0">{header}</div>
            )}
            <div
                className="relative z-0 min-h-0 flex-1 overflow-y-auto"
                style={{
                    ["--header-offset" as never]: "0px",
                    ["--contradiction-banner-offset" as never]: "0px",
                }}
            >
                {content}
            </div>
            {footer !== undefined && (
                <div className="relative z-[40] shrink-0 border-t border-border/30">
                    {footer}
                </div>
            )}
        </div>
    );
}

export interface ModalProps extends Omit<ModalChromeProps, "children">, ModalBandsProps {}

/**
 * Static three-band modal. Pass `open`, `header`, `content`,
 * `footer`. The chrome and band styling are identical to whatever
 * `useModalStack().push(...)` renders, so the visual is the same
 * regardless of static or dynamic usage.
 */
export function Modal({
    header,
    content,
    footer,
    ...chromeProps
}: ModalProps) {
    return (
        <ModalChrome {...chromeProps}>
            <ModalBands header={header} content={content} footer={footer} />
        </ModalChrome>
    );
}
