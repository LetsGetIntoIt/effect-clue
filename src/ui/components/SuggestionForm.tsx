"use client";

import { useTranslations } from "next-intl";
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import type { DraftSuggestion } from "../../logic/ClueState";
import type { GameSetup } from "../../logic/GameSetup";
import { categoryOfCard } from "../../logic/GameSetup";
import type { Card, Player } from "../../logic/GameObjects";
import { newSuggestionId } from "../../logic/Suggestion";
import { registerSuggestionFormFocusHandler } from "../suggestionFormFocus";
import { label, matches } from "../keyMap";
import { Tooltip } from "./Tooltip";
import {
    displayCard,
    displayCardOpt,
    displayPassers,
    displayPlayer,
    displayPlayerOpt,
    isInsideSuggestionPopover,
    isNobody,
    MultiSelectList,
    NOBODY,
    type Nobody,
    type Option,
    PillPopover,
    pillStatusForCard,
    pillStatusForPassers,
    pillStatusForPlayer,
    SingleSelectList,
} from "./SuggestionPills";

/**
 * Pill-driven form for composing (or editing) a suggestion.
 *
 * Each `DraftSuggestion` slot — suggester, one card per category, the
 * three optional passers / refuter / shown-card slots — is rendered
 * as a pill. The pill is both the status display and the value
 * picker: clicking it opens a popover with the candidate list.
 * Selecting a value advances focus to the next pill; the sequence
 * terminates on the Add button.
 *
 * Props:
 *   - `suggestion` — if present, pre-populates from that draft and
 *     dispatches as an edit (caller should wire onSubmit to
 *     `updateSuggestion`). If absent, the form starts empty and a
 *     fresh `SuggestionId` is minted on submit.
 *   - `onSubmit` — the caller decides which reducer action to fire.
 *     The form never touches `useClue` directly.
 *   - `onCancel` — rendered as a secondary button when provided;
 *     the add-flow passes no `onCancel`, the edit-flow passes one
 *     that closes the in-place editor.
 *
 * Submit contract:
 *   - Required pills (suggester + all cards) must be filled for the
 *     Add button to enable. The button gets `autoFocus` at that
 *     moment so a single Enter keystroke submits.
 *   - `Cmd+Enter` / `Ctrl+Enter` submits from anywhere inside the
 *     form, including open popovers.
 *
 * Optional pills ("Passed by", "Refuted by", "Shown card") each
 * surface an explicit "Nobody" row in their popover. Picking it
 * records an explicit "no one passed" / "no one refuted" /
 * "no card shown" state — distinct from "not decided yet" — and the
 * pill renders a checked `✓` instead of the dashed outline.
 */
export function SuggestionForm({
    setup,
    suggestion,
    onSubmit,
    onCancel,
}: {
    readonly setup: GameSetup;
    readonly suggestion?: DraftSuggestion;
    readonly onSubmit: (draft: DraftSuggestion) => void;
    readonly onCancel?: () => void;
}): React.ReactElement {
    const t = useTranslations("suggestions");

    // --- Form state ----------------------------------------------------
    const [form, setForm] = useState<FormState>(() =>
        suggestion !== undefined
            ? formStateFromDraft(suggestion, setup)
            : emptyFormState(setup),
    );

    // Re-seed when the suggestion prop changes (covers the "edit
    // different row" case without remounting the whole component).
    const seededIdRef = useRef<string | undefined>(suggestion?.id);
    useEffect(() => {
        if (suggestion?.id === seededIdRef.current) return;
        seededIdRef.current = suggestion?.id;
        setForm(
            suggestion !== undefined
                ? formStateFromDraft(suggestion, setup)
                : emptyFormState(setup),
        );
    }, [suggestion, setup]);

    // --- Pill sequence for auto-advance -------------------------------
    //
    // `pillSequence` is the ordered list of pill IDs as they appear
    // left-to-right. `nextPillId` walks the list from a starting
    // point, skipping pills that are currently disabled (shown-card
    // without a resolved refuter). "submit" is the terminal token
    // meaning "focus the Add button next."
    const pillSequence: ReadonlyArray<PillId> = useMemo(
        () => buildPillSequence(setup),
        [setup],
    );

    const isPillDisabled = useCallback(
        (id: PillId): boolean => isPillDisabledFor(form, id),
        [form],
    );

    // --- Popover open-state --------------------------------------------
    //
    // Exactly one popover is open at a time (or none). Hover / focus /
    // click any pill: that becomes the open one. Auto-advance after a
    // commit: we set openPillId to the next pill, which propagates via
    // `open` prop to the right RadixPopover.Root.
    //
    // The terminal value "submit" means "no popover open; the Add
    // button should get focus." See the effect below.
    const [openPillId, setOpenPillId] = useState<OpenTarget>(null);
    const submitBtnRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (openPillId === TARGET_SUBMIT) {
            submitBtnRef.current?.focus();
        }
    }, [openPillId]);

    /**
     * Commit a new form AND move focus to the next enabled pill.
     * Both state updates are computed synchronously off the same
     * `next` snapshot so advance sees the post-commit `refuter`
     * (key for re-enabling PILL_SEEN) without waiting for a
     * re-render.
     */
    const commitAndAdvance = useCallback(
        (next: FormState, from: PillId) => {
            setForm(next);
            setOpenPillId(
                nextEnabledPill(pillSequence, from, id =>
                    isPillDisabledFor(next, id),
                ),
            );
        },
        [pillSequence],
    );

    /**
     * Per-pill open-state updater. Fires `setOpenPillId` to this
     * pill when `open` goes true; clears the state only when it was
     * *this* pill that was open.
     *
     * Why the guard? Each pill owns its own 150ms close timer. If
     * the pointer moves quickly from pill A to pill B, B's enter
     * fires first and opens B — then A's delayed close fires 150ms
     * later. Without the guard, A's close would clobber B's state.
     * With the guard, A's "close me" only acts if we're still on A.
     */
    const onOpenChangeFor = useCallback(
        (pillId: PillId) => (open: boolean) => {
            setOpenPillId(prev =>
                open ? pillId : prev === pillId ? null : prev,
            );
        },
        [],
    );

    // --- Commit helpers ------------------------------------------------
    //
    // Each pill's popover commits a value through one of these. The
    // shape is uniform: compute `next`, then hand off to
    // `commitAndAdvance`. Passers commit differently (Enter confirms
    // the multi-select) — see MultiSelectList below.
    // Required pill callbacks widen to accept `Nobody` because the
    // SingleSelectList generic can't statically know that required
    // pills omit the Nobody row. At runtime we never call them with
    // NOBODY (the list's `nobodyValue={null}` suppresses that row),
    // but the early-return guards give TypeScript the narrow it
    // needs.
    const commitSuggester = useCallback(
        (value: Player | Nobody) => {
            if (isNobody(value)) return;
            commitAndAdvance(
                { ...form, suggester: value },
                PILL_SUGGESTER,
            );
        },
        [form, commitAndAdvance],
    );
    const commitCard = useCallback(
        (index: number, value: Card | Nobody) => {
            if (isNobody(value)) return;
            const nextCards = form.cards.slice();
            nextCards[index] = value;
            commitAndAdvance(
                { ...form, cards: nextCards },
                `card-${index}` as PillId,
            );
        },
        [form, commitAndAdvance],
    );
    const commitPassers = useCallback(
        (
            value: ReadonlyArray<Player> | Nobody,
            opts: { advance: boolean } = { advance: true },
        ) => {
            const next = { ...form, nonRefuters: value };
            if (opts.advance) {
                commitAndAdvance(next, PILL_PASSERS);
            } else {
                setForm(next);
            }
        },
        [form, commitAndAdvance],
    );
    const commitRefuter = useCallback(
        (value: Player | Nobody) => {
            // If refuter becomes NOBODY, the shown-card pill turns
            // unreachable (disabled) — clear any old seenCard so the
            // user can't leave a stale value stranded. When refuter
            // switches to a different resolved player, keep seenCard
            // as-is: if it's no longer in the suggested cards, the
            // error-state will surface the mismatch in PILL_SEEN.
            const nextSeenCard = isNobody(value) ? null : form.seenCard;
            commitAndAdvance(
                { ...form, refuter: value, seenCard: nextSeenCard },
                PILL_REFUTER,
            );
        },
        [form, commitAndAdvance],
    );
    const commitSeenCard = useCallback(
        (value: Card | Nobody) => {
            commitAndAdvance({ ...form, seenCard: value }, PILL_SEEN);
        },
        [form, commitAndAdvance],
    );

    // --- Submit --------------------------------------------------------
    const draft = useMemo(() => buildDraftFromForm(form), [form]);
    const errors = useMemo(() => validateFormConsistency(form), [form]);
    const canSubmit = draft !== null && errors.size === 0;

    const pillLabelFor = useCallback(
        (id: PillId): string => {
            if (id === PILL_SUGGESTER) return t("pillSuggester");
            if (id === PILL_PASSERS) return t("pillPassers");
            if (id === PILL_REFUTER) return t("pillRefuter");
            if (id === PILL_SEEN) return t("pillSeen");
            // card-N
            const match = /^card-(\d+)$/.exec(id);
            if (match !== null) {
                const idx = Number(match[1]);
                return setup.categories[idx]?.name ?? id;
            }
            return id;
        },
        [t, setup.categories],
    );

    const errorMessageFor = useCallback(
        (code: PillErrorCode): string => {
            switch (code) {
                case "seenCardNotSuggested":
                    return t("pillErrorSeenCardNotSuggested");
                case "seenCardWithoutRefuter":
                    return t("pillErrorSeenCardWithoutRefuter");
                case "suggesterIsRefuter":
                    return t("pillErrorSuggesterIsRefuter");
                case "suggesterInPassers":
                    return t("pillErrorSuggesterInPassers");
                case "refuterInPassers":
                    return t("pillErrorRefuterInPassers");
            }
        },
        [t],
    );

    const errorReasonFor = useCallback(
        (id: PillId): string | undefined => {
            const code = errors.get(id);
            return code === undefined ? undefined : errorMessageFor(code);
        },
        [errors, errorMessageFor],
    );

    const submitBlockReason = useMemo<string | undefined>(() => {
        if (canSubmit) return undefined;
        if (errors.size > 0) {
            const fields = Array.from(errors.keys()).map(pillLabelFor);
            return t("submitDisabledFixError", {
                fields: formatFieldList(fields),
            });
        }
        const missing: Array<string> = [];
        if (form.suggester === null) missing.push(t("pillSuggester"));
        form.cards.forEach((c, i) => {
            if (c === null) {
                missing.push(setup.categories[i]?.name ?? `card-${i}`);
            }
        });
        if (missing.length === 0) return undefined;
        return t("submitDisabledFillIn", {
            fields: formatFieldList(missing),
        });
    }, [canSubmit, errors, form, setup.categories, pillLabelFor, t]);

    const doSubmit = useCallback(() => {
        if (!canSubmit || draft === null) return;
        onSubmit(draft);
        // Add-flow: reset and return to the first pill.
        // Edit-flow: the parent unmounts us via onCancel-equivalent
        // after it processes the update, so resetting is harmless.
        if (suggestion === undefined) {
            setForm(emptyFormState(setup));
            setOpenPillId(PILL_SUGGESTER);
        }
    }, [canSubmit, draft, onSubmit, suggestion, setup]);

    /**
     * Cmd/Ctrl+Enter submits from anywhere inside the form —
     * including inside any open popover content. The popovers render
     * in a Radix Portal, so we catch the event at the document level
     * only while the form is mounted AND a popover is open OR focus
     * is within the form root.
     */
    const formRootRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!matches("action.submit", e)) return;
            // Only handle if focus is inside our form root or in any
            // Radix portal popover owned by our form (we check by
            // walking up from the focused element).
            const active = document.activeElement as Element | null;
            const root = formRootRef.current;
            if (
                !root ||
                !active ||
                !(root.contains(active) || isInsideSuggestionPopover(active))
            ) {
                return;
            }
            e.preventDefault();
            doSubmit();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [doSubmit]);

    /**
     * Pill-to-pill navigation keys. ArrowLeft/Right and Tab/Shift+Tab
     * step backward/forward through the enabled-pill sequence,
     * opening each pill's popover (mirrors auto-advance-on-commit).
     *
     * Boundary rule: Shift+Tab at the head escapes the form (don't
     * preventDefault) so keyboard users aren't trapped. ArrowLeft at
     * the head is a no-op — arrow keys aren't expected to leave the
     * widget.
     */
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
            const inPopover = isInsideSuggestionPopover(active);
            if (!onPillTrigger && !inPopover && !onSubmitBtn) return;

            // Resolve the "current" pill we're navigating from.
            let current: PillId | null = null;
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
                if (id !== null && id !== undefined) {
                    current = id as PillId;
                }
            }

            const goingBack = isLeft || isShiftTab;

            if (goingBack) {
                // Explicit keyboard nav INCLUDES disabled pills — a
                // disabled pill is now focusable and its popover shows
                // the reason it's unavailable.
                const from =
                    current ?? pillSequence[pillSequence.length - 1] ?? null;
                if (from === null) return;
                const target = onSubmitTarget
                    ? from
                    : prevPill(pillSequence, from);
                if (target === null) {
                    // At the head. Arrows stay put; Shift+Tab escapes.
                    if (isLeft) e.preventDefault();
                    return;
                }
                e.preventDefault();
                setOpenPillId(target);
                return;
            }

            // Forward (ArrowRight or Tab)
            if (onSubmitTarget) return; // already at terminal; let native run
            if (current === null) return;
            const target = nextPill(pillSequence, current);
            e.preventDefault();
            setOpenPillId(target);
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [pillSequence, openPillId]);

    // --- Clear-inputs affordance ---------------------------------------
    //
    // "Any value set" check drives the Clear link's visibility. We
    // want it to appear as soon as the user picks anything (including
    // an explicit "Nobody" on an optional pill) so they have a quick
    // escape hatch back to a blank form without losing the in-place
    // edit prop.
    const hasAnyInput =
        form.suggester !== null ||
        form.cards.some(c => c !== null) ||
        form.nonRefuters !== null ||
        form.refuter !== null ||
        form.seenCard !== null;
    const onClearInputs = useCallback(() => {
        setForm(emptyFormState(setup));
        setOpenPillId(null);
    }, [setup]);

    // Cmd/Ctrl+K shortcut: the global listener in ClueProvider calls
    // `requestFocusSuggestionForm`; we register the actual focus/clear
    // action here so it runs against our local state.
    useEffect(() => {
        return registerSuggestionFormFocusHandler(({ clear }) => {
            if (clear) setForm(emptyFormState(setup));
            setOpenPillId(PILL_SUGGESTER);
        });
    }, [setup]);

    // --- Render --------------------------------------------------------
    return (
        <div ref={formRootRef}>
            <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="mt-0 mb-0 text-[14px] font-semibold">
                    {suggestion !== undefined
                        ? t("editTitle")
                        : t.rich("addTitle", {
                              shortcutKey: label("global.gotoPlay"),
                              shortcut: chunks => (
                                  <span className="font-normal text-muted">
                                      {chunks}
                                  </span>
                              ),
                          })}
                </h3>
                {hasAnyInput && (
                    <button
                        type="button"
                        onClick={onClearInputs}
                        className="inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[12px] text-muted hover:text-accent"
                    >
                        <span aria-hidden className="text-[14px] leading-none">
                            ×
                        </span>
                        {t("clearInputs")}
                    </button>
                )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                {/* Suggester pill */}
                <PillPopover
                    pillId={PILL_SUGGESTER}
                    label={t("pillSuggester")}
                    status={pillStatusForPlayer(form.suggester, false)}
                    valueDisplay={displayPlayer(form.suggester)}
                    errorReason={errorReasonFor(PILL_SUGGESTER)}
                    open={openPillId === PILL_SUGGESTER}
                    onOpenChange={onOpenChangeFor(PILL_SUGGESTER)}
                >
                    <SingleSelectList<Player>
                        options={suggesterOptions(setup, form)}
                        selected={form.suggester}
                        onCommit={commitSuggester}
                        nobodyLabel={null}
                        nobodyValue={null}
                    />
                </PillPopover>

                {/* Per-category card pills */}
                {setup.categories.map((cat, i) => (
                    <PillPopover
                        key={cat.id}
                        pillId={`card-${i}` as PillId}
                        label={cat.name}
                        status={pillStatusForCard(form.cards[i] ?? null, false)}
                        valueDisplay={displayCard(
                            form.cards[i] ?? null,
                            setup,
                        )}
                        errorReason={errorReasonFor(`card-${i}` as PillId)}
                        open={openPillId === (`card-${i}` as PillId)}
                        onOpenChange={onOpenChangeFor(
                            `card-${i}` as PillId,
                        )}
                    >
                        <SingleSelectList<Card>
                            options={cat.cards.map(c => ({
                                value: c.id,
                                label: c.name,
                            }))}
                            selected={form.cards[i] ?? null}
                            onCommit={value => commitCard(i, value)}
                            nobodyLabel={null}
                            nobodyValue={null}
                        />
                    </PillPopover>
                ))}

                {/* Passed-by (multi-select with "nobody" escape hatch) */}
                <PillPopover
                    pillId={PILL_PASSERS}
                    label={t("pillPassers")}
                    status={pillStatusForPassers(form.nonRefuters)}
                    valueDisplay={displayPassers(form.nonRefuters, t)}
                    errorReason={errorReasonFor(PILL_PASSERS)}
                    open={openPillId === PILL_PASSERS}
                    onOpenChange={onOpenChangeFor(PILL_PASSERS)}
                >
                    <MultiSelectList
                        options={passersOptions(setup, form)}
                        selected={
                            Array.isArray(form.nonRefuters)
                                ? form.nonRefuters
                                : []
                        }
                        nobodyChosen={
                            form.nonRefuters !== null &&
                            isNobody(form.nonRefuters)
                        }
                        nobodyLabel={t("popoverNobodyPassed")}
                        commitHint={t("popoverCommitHint")}
                        onCommit={commitPassers}
                    />
                </PillPopover>

                {/* Refuted-by (single-select + "nobody") */}
                <PillPopover
                    pillId={PILL_REFUTER}
                    label={t("pillRefuter")}
                    status={pillStatusForPlayer(form.refuter, true)}
                    valueDisplay={displayPlayerOpt(form.refuter, t)}
                    errorReason={errorReasonFor(PILL_REFUTER)}
                    open={openPillId === PILL_REFUTER}
                    onOpenChange={onOpenChangeFor(PILL_REFUTER)}
                >
                    <SingleSelectList<Player>
                        options={refuterOptions(setup, form)}
                        selected={
                            isNobody(form.refuter) ? null : form.refuter
                        }
                        onCommit={commitRefuter}
                        nobodyLabel={t("popoverNobodyRefuted")}
                        nobodyValue={NOBODY}
                    />
                </PillPopover>

                {/* Shown card (gated on a resolved refuter) */}
                <PillPopover
                    pillId={PILL_SEEN}
                    label={t("pillSeen")}
                    status={pillStatusForCard(form.seenCard, true)}
                    valueDisplay={displayCardOpt(form.seenCard, setup, t)}
                    disabled={isPillDisabled(PILL_SEEN)}
                    disabledHint={t("pillSeenDisabledHint")}
                    errorReason={errorReasonFor(PILL_SEEN)}
                    open={openPillId === PILL_SEEN}
                    onOpenChange={onOpenChangeFor(PILL_SEEN)}
                >
                    <SingleSelectList<Card>
                        options={suggestedCardOptions(form, setup)}
                        selected={
                            isNobody(form.seenCard) ? null : form.seenCard
                        }
                        onCommit={commitSeenCard}
                        nobodyLabel={t("popoverNoShownCard")}
                        nobodyValue={NOBODY}
                    />
                </PillPopover>

                {/*
                  * Add button lives inline with the pills so the whole
                  * form reads as a single row. Matches the pill height
                  * (px-3 py-2 text-[13px]) but keeps the default
                  * `rounded` radius instead of `rounded-full`, so it
                  * reads as a squared-off primary action distinct from
                  * the round pills.
                  */}
                <Tooltip content={submitBlockReason}>
                    <button
                        type="button"
                        ref={submitBtnRef}
                        className={
                            "rounded border-none px-3 py-2 text-[13px] " +
                            (canSubmit
                                ? "cursor-pointer bg-accent text-white"
                                : "cursor-not-allowed bg-unknown-bg text-muted/70")
                        }
                        aria-disabled={!canSubmit}
                        onClick={doSubmit}
                    >
                        {t("submit", { shortcut: label("action.submit") })}
                    </button>
                </Tooltip>
                {onCancel !== undefined && (
                    <button
                        type="button"
                        className="cursor-pointer rounded border border-border bg-white px-3 py-2 text-[13px]"
                        onClick={onCancel}
                    >
                        {t("cancelAction")}
                    </button>
                )}
            </div>
        </div>
    );
}

// ---- Form state -------------------------------------------------------

export interface FormState {
    readonly id: string;
    readonly suggester: Player | null;
    readonly cards: ReadonlyArray<Card | null>;
    readonly nonRefuters: ReadonlyArray<Player> | Nobody | null;
    readonly refuter: Player | Nobody | null;
    readonly seenCard: Card | Nobody | null;
}

const emptyFormState = (setup: GameSetup): FormState => ({
    id: String(newSuggestionId()),
    suggester: null,
    cards: setup.categories.map(() => null),
    nonRefuters: null,
    refuter: null,
    seenCard: null,
});

const formStateFromDraft = (
    s: DraftSuggestion,
    setup: GameSetup,
): FormState => {
    // Map the flat `cards` array back into per-category slots. Cards
    // whose category isn't in the current setup are dropped (which
    // will show the slot as unfilled).
    const byCategory = new Map<string, Card>();
    for (const cardId of s.cards) {
        const catId = categoryOfCard(setup, cardId);
        if (catId !== undefined) byCategory.set(String(catId), cardId);
    }
    return {
        id: String(s.id),
        suggester: s.suggester,
        cards: setup.categories.map(
            c => byCategory.get(String(c.id)) ?? null,
        ),
        // Only differentiate "not decided" vs "nobody" on new rows —
        // existing drafts don't carry the sentinel, so we treat
        // empty arrays / undefined as "not decided" (null). Users
        // who explicitly want to mark "nobody passed" can do so
        // by opening the pill.
        nonRefuters: s.nonRefuters.length > 0 ? s.nonRefuters : null,
        refuter: s.refuter ?? null,
        seenCard: s.seenCard ?? null,
    };
};

/**
 * Pure conversion: form state → `DraftSuggestion | null`.
 *
 * Returns `null` when any required slot is unfilled. For optional
 * slots, the `NOBODY` sentinel and `null` collapse to the same
 * DraftSuggestion shape: empty array / undefined.
 *
 * Mapping:
 *   nonRefuters: NOBODY | null | Player[]  ->  ReadonlyArray<Player>
 *                                               (deduped, order-preserving)
 *   refuter:     NOBODY | null | Player    ->  Player | undefined
 *   seenCard:    NOBODY | null | Card      ->  Card | undefined
 */
export const buildDraftFromForm = (
    form: FormState,
): DraftSuggestion | null => {
    if (form.suggester === null) return null;
    const cards: Array<Card> = [];
    for (const c of form.cards) {
        if (c === null) return null;
        cards.push(c);
    }
    const nonRefuters: ReadonlyArray<Player> =
        form.nonRefuters === null || isNobody(form.nonRefuters)
            ? []
            : Array.from(new Set(form.nonRefuters));
    // Narrow the optional fields: the exactOptionalPropertyTypes
    // DraftSuggestion wants the field omitted (not `undefined`) when
    // no value was picked. Spread a one-off object only when the
    // value is resolved.
    const refuterField =
        form.refuter !== null && !isNobody(form.refuter)
            ? { refuter: form.refuter }
            : {};
    const seenCardField =
        form.seenCard !== null && !isNobody(form.seenCard)
            ? { seenCard: form.seenCard }
            : {};
    const result: DraftSuggestion = {
        id: form.id as DraftSuggestion["id"],
        suggester: form.suggester,
        cards,
        nonRefuters,
        ...refuterField,
        ...seenCardField,
    };
    return result;
};

// ---- Pill sequence / auto-advance ------------------------------------

export type PillId =
    | "suggester"
    | `card-${number}`
    | "passers"
    | "refuter"
    | "seenCard";

 
// PillId + OpenTarget string literals are internal discriminators,
// never shown to the user. They drive the auto-advance state
// machine; keeping them as raw strings makes the code readable.
type OpenTarget = PillId | "submit" | null;

export const PILL_SUGGESTER: PillId = "suggester";
export const PILL_PASSERS: PillId = "passers";
export const PILL_REFUTER: PillId = "refuter";
export const PILL_SEEN: PillId = "seenCard";
const TARGET_SUBMIT = "submit" as const;

const buildPillSequence = (setup: GameSetup): ReadonlyArray<PillId> => {
    const ids: Array<PillId> = [PILL_SUGGESTER];
    for (let i = 0; i < setup.categories.length; i++) {
        ids.push(`card-${i}` as PillId);
    }
    ids.push(PILL_PASSERS, PILL_REFUTER, PILL_SEEN);
    return ids;
};

/**
 * Given the current pill and a disabled-check, find the next pill in
 * `sequence` that isn't disabled. Returns `TARGET_SUBMIT` when the
 * sequence runs out — the Add button is the terminal focus target.
 */
const nextEnabledPill = (
    sequence: ReadonlyArray<PillId>,
    current: PillId,
    isDisabled: (id: PillId) => boolean,
): OpenTarget => {
    const idx = sequence.indexOf(current);
    for (let i = idx + 1; i < sequence.length; i++) {
        const id = sequence[i]!;
        if (!isDisabled(id)) return id;
    }
    return TARGET_SUBMIT;
};

/**
 * Next pill in the sequence regardless of disabled state — for
 * explicit keyboard navigation (Tab / ArrowRight). Disabled pills
 * ARE focusable now; their popover explains the reason. Auto-advance
 * after commit still uses `nextEnabledPill` so focus doesn't stop on
 * a pill the user can't act on.
 */
const nextPill = (
    sequence: ReadonlyArray<PillId>,
    current: PillId,
): OpenTarget => {
    const idx = sequence.indexOf(current);
    if (idx < 0 || idx >= sequence.length - 1) return TARGET_SUBMIT;
    return sequence[idx + 1]!;
};

const prevPill = (
    sequence: ReadonlyArray<PillId>,
    current: PillId,
): PillId | null => {
    const idx = sequence.indexOf(current);
    if (idx <= 0) return null;
    return sequence[idx - 1]!;
};

// ---- Disabled-pill + internal-consistency helpers --------------------

/**
 * Pure: is this pill disabled given a form snapshot? Extracted so
 * commit handlers can ask about the POST-commit state without going
 * through a `useCallback` that still closes over the pre-commit form.
 */
export const isPillDisabledFor = (
    form: FormState,
    id: PillId,
): boolean =>
    id === PILL_SEEN &&
    (form.refuter === null || isNobody(form.refuter));

/**
 * Internal-consistency error codes. These describe paradoxes WITHIN
 * a single suggestion — not external contradictions caught by the
 * solver. `GlobalContradictionBanner` covers the latter.
 */
export type PillErrorCode =
    | "seenCardNotSuggested"
    | "seenCardWithoutRefuter"
    | "suggesterIsRefuter"
    | "suggesterInPassers"
    | "refuterInPassers";

/**
 * Check a form snapshot for internal paradoxes. Returns a map from
 * the first-offending pill to an error code. One error per pill; if
 * a pill has multiple problems the first-listed rule wins.
 *
 * Most cross-role paradoxes are prevented at input time by the
 * option-builder filters (e.g. `suggesterOptions` excludes the
 * current refuter). This validator is the RETROACTIVE safety net
 * for values that were valid at entry but became stale after a
 * later edit — most commonly, a `seenCard` whose corresponding
 * category card was subsequently changed.
 */
export const validateFormConsistency = (
    form: FormState,
): ReadonlyMap<PillId, PillErrorCode> => {
    const errors = new Map<PillId, PillErrorCode>();

    // PILL_SEEN: must be one of the suggested cards, and requires a
    // resolved refuter. (Only reachable as an error in the inline
    // edit — the Add form's pill ordering prevents setting seenCard
    // without a refuter.)
    if (form.seenCard !== null && !isNobody(form.seenCard)) {
        if (form.refuter === null || isNobody(form.refuter)) {
            // eslint-disable-next-line i18next/no-literal-string -- internal error code
            errors.set(PILL_SEEN, "seenCardWithoutRefuter");
        } else {
            const cards = suggestedCards(form);
            if (!cards.some(c => c === form.seenCard)) {
                // eslint-disable-next-line i18next/no-literal-string -- internal error code
                errors.set(PILL_SEEN, "seenCardNotSuggested");
            }
        }
    }

    // Defensive cross-role checks — the option-builders normally
    // prevent these, but validate anyway so mistakes from any
    // future change surface clearly.
    const passers: ReadonlyArray<Player> = Array.isArray(form.nonRefuters)
        ? form.nonRefuters
        : [];

    if (
        form.suggester !== null &&
        form.refuter !== null &&
        !isNobody(form.refuter) &&
        form.suggester === form.refuter
    ) {
        // eslint-disable-next-line i18next/no-literal-string -- internal error code
        errors.set(PILL_REFUTER, "suggesterIsRefuter");
    }
    if (
        form.suggester !== null &&
        passers.some(p => p === form.suggester)
    ) {
        // eslint-disable-next-line i18next/no-literal-string -- internal error code
        errors.set(PILL_SUGGESTER, "suggesterInPassers");
    }
    if (
        form.refuter !== null &&
        !isNobody(form.refuter) &&
        passers.some(p => p === form.refuter)
    ) {
        if (!errors.has(PILL_REFUTER)) {
            // eslint-disable-next-line i18next/no-literal-string -- internal error code
            errors.set(PILL_REFUTER, "refuterInPassers");
        }
    }

    return errors;
};

/**
 * Format a list of field labels for a blocking-reason tooltip.
 * Uses the browser's Intl.ListFormat so "A, B, and C" reads
 * naturally in non-English locales too. Falls back to a simple
 * join when ListFormat isn't available.
 */
const formatFieldList = (fields: ReadonlyArray<string>): string => {
    if (fields.length === 0) return "";
    if (typeof Intl !== "undefined" && "ListFormat" in Intl) {
        try {
            return new Intl.ListFormat(undefined, {
                // eslint-disable-next-line i18next/no-literal-string -- Intl ListFormat option value
                style: "long",
                type: "conjunction",
            }).format(fields);
        } catch {
            // fall through
        }
    }
    return fields.join(", ");
};


// ---- Candidate list helpers ------------------------------------------

/**
 * Players available for the suggester slot. Excludes anyone already
 * playing the refuter or passer roles in this suggestion — Clue
 * grammar makes those disjoint.
 */
const suggesterOptions = (
    setup: GameSetup,
    form: FormState,
): ReadonlyArray<Option<Player>> => {
    const excluded = new Set<Player>();
    if (form.refuter !== null && !isNobody(form.refuter)) {
        excluded.add(form.refuter);
    }
    if (Array.isArray(form.nonRefuters)) {
        for (const p of form.nonRefuters) excluded.add(p);
    }
    return setup.players
        .filter(p => !excluded.has(p))
        .map(p => ({ value: p, label: String(p) }));
};

/**
 * Players available for the passers list. Excludes the suggester
 * and the refuter (both disjoint from passing in Clue rules).
 */
const passersOptions = (
    setup: GameSetup,
    form: FormState,
): ReadonlyArray<Option<Player>> => {
    const excluded = new Set<Player>();
    if (form.suggester !== null) excluded.add(form.suggester);
    if (form.refuter !== null && !isNobody(form.refuter)) {
        excluded.add(form.refuter);
    }
    return setup.players
        .filter(p => !excluded.has(p))
        .map(p => ({ value: p, label: String(p) }));
};

/**
 * Players available for the refuter slot. Excludes the suggester
 * and anyone already in the passers list.
 */
const refuterOptions = (
    setup: GameSetup,
    form: FormState,
): ReadonlyArray<Option<Player>> => {
    const excluded = new Set<Player>();
    if (form.suggester !== null) excluded.add(form.suggester);
    if (Array.isArray(form.nonRefuters)) {
        for (const p of form.nonRefuters) excluded.add(p);
    }
    return setup.players
        .filter(p => !excluded.has(p))
        .map(p => ({ value: p, label: String(p) }));
};

/**
 * Candidates for "shown card" — the three cards that were actually
 * suggested. Keeps today's invariant that a refuter can only show
 * one of the named cards.
 */
const suggestedCardOptions = (
    form: FormState,
    setup: GameSetup,
): ReadonlyArray<Option<Card>> =>
    form.cards.flatMap((c, i): Array<Option<Card>> => {
        if (c === null) return [];
        const cat = setup.categories[i];
        const entry = cat?.cards.find(e => e.id === c);
        if (entry === undefined) return [];
        return [{ value: c, label: entry.name }];
    });

const suggestedCards = (form: FormState): ReadonlyArray<Card> =>
    form.cards.flatMap(c => (c === null ? [] : [c]));

