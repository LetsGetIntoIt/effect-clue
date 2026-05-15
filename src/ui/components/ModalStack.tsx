/**
 * Generic modal stack — replaces nested `Dialog.Root` modals with a
 * single root-mounted Radix Dialog whose content is the top of a
 * push/pop stack.
 *
 * **Why:** when an inner modal opened from inside an outer modal, two
 * Radix `Dialog.Root`s fought over the same z-indices and focus trap;
 * the inner one was effectively invisible (the My Card Packs share
 * button bug). The stack keeps the outer Dialog mounted but swaps
 * content as modals push/pop, so layering is impossible.
 *
 * **Visuals:** push slides the new content in from the right while the
 * previous content slides out to the left; pop reverses. Height
 * auto-animates between entries (Framer's `layout` prop), so a small
 * confirm pushed over a tall account modal grows/shrinks smoothly.
 *
 * **API:**
 *   - `push({ id, title, content, ... })` — opens a modal.
 *   - `pop()` — closes the top entry. Fires that entry's `onClose`.
 *   - `popTo(id)` — closes everything above (and including) the entry
 *     with the given id. Fires `onClose` for each in stack order.
 *   - `closeAll()` — empties the stack.
 *
 * **Alert-style modals:** confirm / prompt / logout-warning opt out of
 * backdrop-click and Escape dismissal via `dismissOnOutsideClick:
 * false` + `dismissOnEscape: false`. Matches the previous
 * `AlertDialog` semantics those modals used.
 */
"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { T_STANDARD, useReducedTransition } from "../motion";

// `mode="wait"` makes the AnimatePresence run exit-then-enter
// sequentially: the popped entry slides out fully before the revealed
// (or pushed) entry slides in. Sequential is the safe choice — overlap
// (`mode="popLayout"`) would need the entries absolutely positioned in
// a grid stack so they don't collide layout-wise, which adds complexity
// without much UX win at modal-swap timing (~200ms).
const PRESENCE_WAIT_MODE = "wait" as const;

const DEFAULT_MAX_WIDTH = "min(92vw,480px)" as const;

// `role="alertdialog"` for entries that block backdrop / Escape
// dismissal — matches the Radix `AlertDialog` role they previously
// rendered. Assistive tech treats alertdialogs as time-critical and
// reads them more aggressively, so we preserve that semantic for
// confirms / prompts / logout-warning.
const ROLE_ALERT_DIALOG = "alertdialog" as const;

interface ModalEntry {
    /** Stable identifier — used for AnimatePresence key, popTo lookup,
     *  and idempotent re-push detection. */
    readonly id: string;
    /** Visible title for accessibility. The shell renders it as a
     *  `Dialog.Title` (visually hidden — modal bodies render their own
     *  visible heading). */
    readonly title: string;
    /** The modal body. Must NOT wrap itself in another `Dialog.Root` /
     *  `Dialog.Content` — the shell provides those. Rendered inside a
     *  scrollable region so content overflowing the viewport scrolls
     *  while `footer` stays pinned. */
    readonly content: ReactNode;
    /** Optional sticky footer pinned to the bottom of the modal,
     *  outside the scrollable content region. Modals with action
     *  buttons (Save / Cancel / Confirm) should pass them here so the
     *  buttons remain visible no matter how tall the body grows. */
    readonly footer?: ReactNode;
    /** Backdrop click pops this entry (default true). Set false for
     *  confirm/prompt/logout-warning style modals where dismissal must
     *  go through an explicit button. */
    readonly dismissOnOutsideClick?: boolean;
    /** Escape pops this entry (default true). Same opt-out as
     *  outside-click for alert-style modals. */
    readonly dismissOnEscape?: boolean;
    /** CSS width for the Dialog content (defaults to
     *  `min(92vw,480px)`). Height always auto-animates to the
     *  rendered content. */
    readonly maxWidth?: string;
    /** Fired when this entry leaves the stack — by `pop()`, `popTo()`,
     *  `closeAll()`, Escape, or outside-click. Useful for the pusher to
     *  clean up local state (e.g. resolving a pending Promise). */
    readonly onClose?: () => void;
}

interface ModalStackContextValue {
    /** Read-only view of the stack — exposed for tests and dev tools. */
    readonly stack: ReadonlyArray<ModalEntry>;
    /** Push a new entry on top. If the top entry already has the same
     *  id, replaces it without animating (idempotent re-push). */
    readonly push: (entry: ModalEntry) => void;
    /** Pop the top entry. No-op when empty. Fires the popped entry's
     *  `onClose`. */
    readonly pop: () => void;
    /** Pop everything from the top down to (and including) the entry
     *  with the given id. No-op when no match. Fires `onClose` for
     *  each removed entry in the order they were popped (top first). */
    readonly popTo: (id: string) => void;
    /** Empty the stack. Fires `onClose` for each removed entry. */
    readonly closeAll: () => void;
}

const ModalStackContext = createContext<ModalStackContextValue | null>(null);

/**
 * Consumer hook. Throws when used outside `<ModalStackProvider>` — that
 * matches `useConfirm` / `usePrompt` / `useAccountContext` in the
 * codebase, since calling these from a tree without the provider mounted
 * is always a bug.
 */
export function useModalStack(): ModalStackContextValue {
    const ctx = useContext(ModalStackContext);
    if (!ctx) {
        throw new Error(
            // eslint-disable-next-line i18next/no-literal-string -- developer-facing assertion
            "useModalStack must be used inside <ModalStackProvider>",
        );
    }
    return ctx;
}

/**
 * Internal: separates the direction ref from the public context so
 * `<ModalStackShell>` mounted deep in the tree can read it without
 * widening the public `useModalStack()` API.
 */
const DirectionRefContext = createContext<React.RefObject<number> | null>(
    null,
);

/**
 * Owns the stack state + push/pop/popTo/closeAll API. Mount HIGH in
 * the tree so any consumer (`useConfirm`, `usePrompt`, opener
 * contexts, deep-tree buttons) can reach it via `useModalStack`.
 *
 * Does NOT render the modal Dialog itself — that's `<ModalStackShell>`,
 * which must be mounted DEEPER (inside every provider whose context
 * pushed content might consume: `ConfirmProvider`, `PromptProvider`,
 * `AccountProvider`, `ShareProvider`, etc.). Splitting them keeps
 * push/pop available everywhere while ensuring rendered content sits
 * inside the full provider stack.
 */
export function ModalStackProvider({
    children,
}: {
    readonly children: ReactNode;
}) {
    const [stack, setStack] = useState<ReadonlyArray<ModalEntry>>([]);
    // Direction tracks the most recent stack mutation: +1 for push (new
    // content slides in from the right), -1 for pop (top slides out to
    // the right, revealed entry slides in from the left), 0 for
    // idempotent replace. Stored in a ref so updating it doesn't cause
    // a render cycle of its own — AnimatePresence reads it at the
    // moment its child key changes, which happens in the same render
    // as the setStack that bumped the direction.
    const directionRef = useRef(0);

    const push = useCallback((entry: ModalEntry) => {
        setStack(prev => {
            const top = prev[prev.length - 1];
            if (top?.id === entry.id) {
                directionRef.current = 0;
                return [...prev.slice(0, -1), entry];
            }
            directionRef.current = 1;
            return [...prev, entry];
        });
    }, []);

    const pop = useCallback(() => {
        setStack(prev => {
            if (prev.length === 0) return prev;
            const popped = prev[prev.length - 1];
            directionRef.current = -1;
            popped?.onClose?.();
            return prev.slice(0, -1);
        });
    }, []);

    const popTo = useCallback((id: string) => {
        setStack(prev => {
            const idx = prev.findIndex(e => e.id === id);
            if (idx === -1) return prev;
            directionRef.current = -1;
            for (let i = prev.length - 1; i >= idx; i -= 1) {
                prev[i]?.onClose?.();
            }
            return prev.slice(0, idx);
        });
    }, []);

    const closeAll = useCallback(() => {
        setStack(prev => {
            if (prev.length === 0) return prev;
            directionRef.current = -1;
            for (let i = prev.length - 1; i >= 0; i -= 1) {
                prev[i]?.onClose?.();
            }
            return [];
        });
    }, []);

    const value = useMemo<ModalStackContextValue>(
        () => ({ stack, push, pop, popTo, closeAll }),
        [stack, push, pop, popTo, closeAll],
    );

    return (
        <ModalStackContext.Provider value={value}>
            <DirectionRefContext.Provider value={directionRef}>
                {children}
            </DirectionRefContext.Provider>
        </ModalStackContext.Provider>
    );
}

/**
 * Renders the active stack entry inside a single Radix `Dialog.Root`.
 * Mount BELOW `<ModalStackProvider>` AND below every other provider
 * whose context any pushed modal might consume — translations,
 * confirm, prompt, account, share, query client, etc. There must be
 * exactly one `<ModalStackShell>` per `<ModalStackProvider>`; mounting
 * two would render the same content twice.
 */
export function ModalStackShell() {
    const { stack, pop } = useModalStack();
    const directionRef = useContext(DirectionRefContext);
    if (!directionRef) {
        throw new Error(
            // eslint-disable-next-line i18next/no-literal-string -- developer-facing assertion
            "ModalStackShell must be inside <ModalStackProvider>",
        );
    }
    return <DialogShellInternal stack={stack} pop={pop} directionRef={directionRef} />;
}

/**
 * Single Radix `Dialog.Root` that renders the top stack entry. Inner
 * `AnimatePresence` slides between entries with the direction the
 * provider just set. Hidden when stack is empty.
 *
 * **Why split out from the provider:** lets the shell consume the same
 * context (or at least the same state values via props) without forcing
 * the provider to know rendering details. Keeps the provider testable
 * in isolation if a future test wants the stack mechanics without the
 * Dialog mounted.
 */
function DialogShellInternal({
    stack,
    pop,
    directionRef,
}: {
    readonly stack: ReadonlyArray<ModalEntry>;
    readonly pop: () => void;
    readonly directionRef: React.RefObject<number>;
}) {
    const transition = useReducedTransition(T_STANDARD, { fadeMs: 120 });
    const top = stack[stack.length - 1];
    const direction = directionRef.current;
    // Keep `Dialog.Root` open as long as the stack is non-empty OR the
    // last entry is still mid-exit. The Portal unmounting under
    // AnimatePresence's exiting child throws "node to be removed is not
    // a child of this node" — defer the open=false flip until
    // `onExitComplete` fires.
    const [dialogOpen, setDialogOpen] = useState(false);
    useEffect(() => {
        if (stack.length > 0) setDialogOpen(true);
    }, [stack.length]);

    return (
        <Dialog.Root
            open={dialogOpen}
            onOpenChange={(next) => {
                // Backdrop click + Escape both flip `open` to false.
                // Per-event opt-outs are wired below
                // (`onPointerDownOutside`, `onEscapeKeyDown`). If both
                // those handlers allow the close, Radix lets it through
                // and we pop here.
                if (!next) pop();
            }}
        >
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-[var(--z-dialog-overlay)] bg-black/40" />
                <Dialog.Content
                    onEscapeKeyDown={(e) => {
                        if (top?.dismissOnEscape === false) e.preventDefault();
                    }}
                    onPointerDownOutside={(e) => {
                        if (top?.dismissOnOutsideClick === false) {
                            e.preventDefault();
                        }
                    }}
                    style={{ width: top?.maxWidth ?? DEFAULT_MAX_WIDTH }}
                    className={
                        "fixed left-1/2 top-1/2 z-[var(--z-dialog-content)] " +
                        "max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 " +
                        "overflow-hidden rounded-[var(--radius)] border border-border " +
                        "bg-panel shadow-[0_10px_28px_rgba(0,0,0,0.28)] focus:outline-none"
                    }
                    aria-describedby={undefined}
                    {...(top?.dismissOnOutsideClick === false ||
                    top?.dismissOnEscape === false
                        ? { role: ROLE_ALERT_DIALOG }
                        : {})}
                    aria-label={top?.title}
                >
                    {/* Modal content components render their own
                        `Dialog.Title` (which Radix uses to label the
                        dialog) — the shell's `aria-label` above is the
                        fallback that suppresses Radix's
                        missing-Title dev warning when a content
                        component opts to omit it.

                        Layout: the motion.div is a flex column that
                        fills the Dialog.Content's `max-h-[calc(100dvh-2rem)]`.
                        `content` lives inside a `flex-1 min-h-0
                        overflow-y-auto` body so it scrolls when too
                        tall to fit. `footer`, when provided, sits in a
                        `shrink-0` band below and stays pinned. Modals
                        without a footer still scroll the same way —
                        the body fills the whole modal height. */}
                    <AnimatePresence
                        mode={PRESENCE_WAIT_MODE}
                        custom={direction}
                        initial={false}
                        onExitComplete={() => {
                            if (stack.length === 0) setDialogOpen(false);
                        }}
                    >
                        {top ? (
                            <motion.div
                                key={top.id}
                                initial={{
                                    x: direction === 0 ? 0 : direction * 60,
                                    opacity: direction === 0 ? 1 : 0,
                                }}
                                animate={{ x: 0, opacity: 1 }}
                                exit={{
                                    x: direction === 0 ? 0 : -direction * 60,
                                    opacity: direction === 0 ? 1 : 0,
                                }}
                                transition={transition}
                                className="flex max-h-[calc(100dvh-2rem)] flex-col"
                            >
                                <div className="min-h-0 flex-1 overflow-y-auto">
                                    {top.content}
                                </div>
                                {top.footer !== undefined && (
                                    <div className="shrink-0 border-t border-border/30">
                                        {top.footer}
                                    </div>
                                )}
                            </motion.div>
                        ) : null}
                    </AnimatePresence>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
