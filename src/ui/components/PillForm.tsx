"use client";

import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    type ReactNode,
    type RefObject,
} from "react";
import { matches } from "../keyMap";
import {
    isInsideSuggestionPopover,
    PillPopover,
    type PillStatus,
} from "./SuggestionPills";
import { XIcon } from "./Icons";
import { Tooltip } from "./Tooltip";

/**
 * Sentinel that callers use to mean "the submit button is the focus
 * target" (rather than any pill). Module-level `as const` so the lint
 * rule's type-narrowing exemption applies at the use site.
 */
const TARGET_SUBMIT = "submit" as const;

/**
 * Open-pill state machine value. `null` = no popover open. A string =
 * the id of an open pill. `TARGET_SUBMIT` = focus is on the submit
 * button (no popover open).
 */
export type OpenTarget = string | typeof TARGET_SUBMIT | null;

/**
 * One pill slot rendered by `PillForm`. The popover body (`content`)
 * is whatever the caller decides — usually a `<SingleSelectList>` or
 * `<MultiSelectList>` whose own `onCommit` handler updates the
 * caller's form state and (via the same closure) advances the open
 * pill via the caller's `onOpenPillIdChange`.
 *
 * The PillForm itself is value-agnostic: it doesn't know about
 * `Player` / `Card` / form state shape. It just renders pills,
 * manages keyboard nav between them, and renders the submit /
 * cancel affordances.
 */
export interface PillSlot {
    readonly id: string;
    readonly label: string;
    readonly status: PillStatus;
    readonly valueDisplay: string | undefined;
    readonly disabled?: boolean | undefined;
    readonly disabledHint?: string | undefined;
    readonly errorReason?: string | undefined;
    /** Per-pill clear (×) affordance. When present, the pill renders the × glyph. */
    readonly onClear?: (() => void) | undefined;
    readonly content: ReactNode;
}

export interface PillFormHandle {
    /**
     * Open the first slot in `pillSequence` (or `slots[0].id` when
     * sequence is omitted). Useful for global focus shortcuts.
     */
    readonly focusFirstPill: () => void;
}

interface PillFormProps {
    readonly slots: ReadonlyArray<PillSlot>;
    /**
     * Pill ids in nav order. Defaults to `slots.map(s => s.id)`. Drives
     * Tab / Arrow navigation between pills. Auto-advance-on-commit is
     * the caller's responsibility — see `nextEnabledPill` below for the
     * canonical helper.
     */
    readonly pillSequence?: ReadonlyArray<string>;
    /** Externally-controlled open pill so the caller can drive auto-advance. */
    readonly openPillId: OpenTarget;
    readonly onOpenPillIdChange: (next: OpenTarget) => void;
    /** Submit affordance. */
    readonly canSubmit: boolean;
    readonly submitLabel: ReactNode;
    /** Tooltip text shown over the disabled submit button. */
    readonly submitBlockReason?: string;
    readonly onSubmit: () => void;
    readonly onCancel?: () => void;
    readonly cancelLabel?: ReactNode;
    /**
     * Header bar — appears above the pill row. Content is whatever
     * heading the caller wants (typically `<h3>...</h3>`). The bar
     * is suppressed entirely if both `headerTitle` and the
     * clear-inputs affordance are absent.
     */
    readonly headerTitle?: ReactNode;
    /**
     * Aria-label for the icon-only clear-inputs button rendered at the
     * right edge of the header bar. The button is visible only when
     * `hasAnyInput === true` and `onClearInputs` is provided.
     */
    readonly clearInputsLabel?: string;
    readonly hasAnyInput?: boolean;
    readonly onClearInputs?: () => void;
    /**
     * Outer scope for Cmd+Enter detection. The form itself counts as
     * a scope; callers like the inline-edit row pass an extra `<li>`
     * ref so a Cmd+Enter from anywhere in the row submits.
     */
    readonly keyboardScopeRef?: RefObject<HTMLElement | null>;
}

/**
 * Pill-driven form scaffold shared between `SuggestionForm` and
 * `AccusationForm`. Encapsulates everything that's identical between
 * the two:
 *
 * - Pill row layout
 * - Submit + cancel button styling
 * - Header bar (title + optional clear-inputs link)
 * - Cmd+Enter to submit (scoped to this form's root)
 * - Tab / Arrow between pills (scoped to this form's root)
 * - Auto-focus the submit button when `openPillId === TARGET_SUBMIT`
 *
 * What stays in the caller:
 *
 * - Form state shape + validation (`buildDraftFromForm` /
 *   `validateFormConsistency` per-form)
 * - Per-slot `content` render (`<SingleSelectList>` / `<MultiSelectList>`)
 * - Auto-advance-on-commit logic (commit closure → `nextEnabledPill` →
 *   `onOpenPillIdChange(next)`)
 * - Domain rules like "clearing the refuter clears the seen card too"
 *
 * The keyboard / focus behaviour matches `SuggestionForm`'s historical
 * UX: Tab and Right-arrow advance through pills; Shift+Tab and
 * Left-arrow step backward; Tab from the submit button escapes the
 * form (no preventDefault); Left-arrow at the head is a no-op.
 */
export const PillForm = forwardRef<PillFormHandle, PillFormProps>(
    function PillForm(
        {
            slots,
            pillSequence: pillSequenceProp,
            openPillId,
            onOpenPillIdChange,
            canSubmit,
            submitLabel,
            submitBlockReason,
            onSubmit,
            onCancel,
            cancelLabel,
            headerTitle,
            clearInputsLabel,
            hasAnyInput,
            onClearInputs,
            keyboardScopeRef,
        },
        ref,
    ) {
        const pillSequence = useMemo(
            () => pillSequenceProp ?? slots.map(s => s.id),
            [pillSequenceProp, slots],
        );

        const formRootRef = useRef<HTMLDivElement>(null);
        const submitBtnRef = useRef<HTMLButtonElement>(null);

        useImperativeHandle(
            ref,
            () => ({
                focusFirstPill: () => {
                    const first = pillSequence[0];
                    if (first !== undefined) onOpenPillIdChange(first);
                },
            }),
            [pillSequence, onOpenPillIdChange],
        );

        // Submit button focus when openPillId reaches TARGET_SUBMIT
        // (auto-advance walked off the end of the pill sequence).
        useEffect(() => {
            if (openPillId === TARGET_SUBMIT) submitBtnRef.current?.focus();
        }, [openPillId]);

        // Cmd/Ctrl+Enter submits from anywhere inside this form —
        // including inside any open popover content, and (when the
        // caller widens it via `keyboardScopeRef`) inside an outer
        // wrapping element. Each form keeps its own scope so two
        // mounted forms never both fire.
        useEffect(() => {
            const onKeyDown = (e: KeyboardEvent) => {
                if (!matches("action.submit", e)) return;
                const root = formRootRef.current;
                const active = document.activeElement as Element | null;
                const scope = keyboardScopeRef?.current ?? null;
                if (
                    !root ||
                    !active ||
                    !(
                        root.contains(active) ||
                        isInsideSuggestionPopover(active) ||
                        (scope !== null && scope.contains(active))
                    )
                ) {
                    return;
                }
                e.preventDefault();
                if (canSubmit) onSubmit();
            };
            document.addEventListener("keydown", onKeyDown);
            return () =>
                document.removeEventListener("keydown", onKeyDown);
        }, [canSubmit, onSubmit, keyboardScopeRef]);

        // Pill-to-pill navigation. ArrowLeft/Right and Tab/Shift+Tab
        // step backward/forward through the pill sequence. The handler
        // runs at the document level but bails out unless focus is
        // inside this form's root (or one of its open popovers).
        //
        // Boundary rules:
        //   - Shift+Tab at the head escapes the form (no preventDefault).
        //   - ArrowLeft at the head is a no-op (preventDefault to swallow).
        //   - Tab from the submit button escapes natively (no preventDefault).
        //
        // Disabled pills are NOT skipped here — they're keyboard-
        // reachable so users can read the disabled tooltip / reason.
        // Auto-advance-on-commit is where disabled-skipping happens
        // (caller territory).
        useEffect(() => {
            const onKeyDown = (e: KeyboardEvent) => {
                if (e.metaKey || e.ctrlKey || e.altKey) return;
                const isLeft = matches("nav.left", e);
                const isRight = matches("nav.right", e);
                const isShiftTab = e.key === "Tab" && e.shiftKey;
                const isTab = e.key === "Tab" && !e.shiftKey;
                if (!isLeft && !isRight && !isShiftTab && !isTab) return;

                const root = formRootRef.current;
                const active = document.activeElement as Element | null;
                if (!root || !active) return;

                const onSubmitBtn = active === submitBtnRef.current;
                const onPillTrigger =
                    root.contains(active) &&
                    active.closest("[data-pill-id]") !== null;
                // Restrict in-popover detection to popovers whose
                // trigger lives in *this* form's root — otherwise we'd
                // steal nav from sibling forms whose popovers share the
                // popover-attribute.
                const inPopover =
                    isInsideSuggestionPopover(active) &&
                    root.querySelector(
                        "[data-pill-id][data-state=\"open\"]",
                    ) !== null;
                if (!onPillTrigger && !inPopover && !onSubmitBtn) return;

                let current: string | null = null;
                let onSubmitTarget = false;
                if (
                    openPillId !== null &&
                    openPillId !== TARGET_SUBMIT
                ) {
                    current = openPillId;
                } else if (openPillId === TARGET_SUBMIT || onSubmitBtn) {
                    onSubmitTarget = true;
                } else if (onPillTrigger) {
                    const id = active
                        .closest("[data-pill-id]")
                        ?.getAttribute("data-pill-id");
                    if (id !== null && id !== undefined) current = id;
                }

                const goingBack = isLeft || isShiftTab;

                if (goingBack) {
                    const from =
                        current ??
                        pillSequence[pillSequence.length - 1] ??
                        null;
                    if (from === null) return;
                    const target = onSubmitTarget
                        ? from
                        : prevPillIn(pillSequence, from);
                    if (target === null) {
                        if (isLeft) e.preventDefault();
                        return;
                    }
                    e.preventDefault();
                    onOpenPillIdChange(target);
                    return;
                }

                // Forward (ArrowRight or Tab)
                if (onSubmitTarget) return; // already at terminal; let native run
                if (current === null) return;
                const target = nextPillIn(pillSequence, current);
                e.preventDefault();
                onOpenPillIdChange(target);
            };
            document.addEventListener("keydown", onKeyDown);
            return () =>
                document.removeEventListener("keydown", onKeyDown);
        }, [pillSequence, openPillId, onOpenPillIdChange]);

        const onOpenChangeFor = useCallback(
            (id: string) => (open: boolean) => {
                if (open) onOpenPillIdChange(id);
                else if (openPillId === id) onOpenPillIdChange(null);
            },
            [openPillId, onOpenPillIdChange],
        );

        const showHeaderBar =
            headerTitle !== undefined ||
            (onClearInputs !== undefined &&
                hasAnyInput === true &&
                clearInputsLabel !== undefined);

        const submitButtonClass =
            "min-h-[44px] rounded border-none px-4 py-2.5 text-[15px] " +
            (canSubmit
                ? "cursor-pointer bg-accent text-white"
                : "cursor-not-allowed bg-unknown-bg text-muted/70");

        return (
            <div ref={formRootRef}>
                {showHeaderBar && (
                    <div className="mb-3 flex items-center justify-between gap-2">
                        {headerTitle ?? <span />}
                        {onClearInputs !== undefined &&
                            hasAnyInput === true &&
                            clearInputsLabel !== undefined && (
                                <button
                                    type="button"
                                    aria-label={clearInputsLabel}
                                    onClick={onClearInputs}
                                    className="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded border-none bg-transparent text-muted hover:text-accent"
                                >
                                    <XIcon size={18} />
                                </button>
                            )}
                    </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                    {slots.map(slot => (
                        <PillPopover
                            key={slot.id}
                            pillId={slot.id}
                            label={slot.label}
                            status={slot.status}
                            valueDisplay={slot.valueDisplay}
                            disabled={slot.disabled}
                            disabledHint={slot.disabledHint}
                            errorReason={slot.errorReason}
                            open={openPillId === slot.id}
                            onOpenChange={onOpenChangeFor(slot.id)}
                            {...(slot.onClear !== undefined
                                ? { onClear: slot.onClear }
                                : {})}
                        >
                            {slot.content}
                        </PillPopover>
                    ))}
                    <Tooltip content={submitBlockReason}>
                        <button
                            type="button"
                            ref={submitBtnRef}
                            className={submitButtonClass}
                            aria-disabled={!canSubmit}
                            onClick={() => {
                                if (canSubmit) onSubmit();
                            }}
                        >
                            {submitLabel}
                        </button>
                    </Tooltip>
                    {onCancel !== undefined && (
                        <button
                            type="button"
                            className="min-h-[44px] cursor-pointer rounded border border-border bg-white px-4 py-2.5 text-[15px]"
                            onClick={onCancel}
                        >
                            {cancelLabel ?? null}
                        </button>
                    )}
                </div>
            </div>
        );
    },
);

/**
 * Walk forward from `from` to the first non-disabled pill, skipping
 * over disabled ones (per `isDisabled`). When the walk runs past the
 * end of the sequence, returns `TARGET_SUBMIT` so callers can pin the
 * submit button as the next focus target.
 */
export const nextEnabledPill = (
    sequence: ReadonlyArray<string>,
    from: string,
    isDisabled: (id: string) => boolean,
): OpenTarget => {
    const idx = sequence.indexOf(from);
    if (idx < 0) return TARGET_SUBMIT;
    for (let i = idx + 1; i < sequence.length; i++) {
        const candidate = sequence[i];
        if (candidate !== undefined && !isDisabled(candidate)) {
            return candidate;
        }
    }
    return TARGET_SUBMIT;
};

const nextPillIn = (
    sequence: ReadonlyArray<string>,
    from: string,
): OpenTarget => {
    const idx = sequence.indexOf(from);
    if (idx < 0) return TARGET_SUBMIT;
    const next = sequence[idx + 1];
    return next !== undefined ? next : TARGET_SUBMIT;
};

const prevPillIn = (
    sequence: ReadonlyArray<string>,
    from: string,
): OpenTarget => {
    const idx = sequence.indexOf(from);
    if (idx <= 0) return null;
    return sequence[idx - 1] ?? null;
};
