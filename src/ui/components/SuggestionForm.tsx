"use client";

import { useTranslations } from "next-intl";
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import type { DraftSuggestion } from "../../logic/ClueState";
import type { GameSetup } from "../../logic/GameSetup";
import { categoryOfCard } from "../../logic/GameSetup";
import type { Card, Player } from "../../logic/GameObjects";
import { newSuggestionId } from "../../logic/Suggestion";
import { label } from "../keyMap";
import {
    nextEnabledPill,
    type OpenTarget,
    PillForm,
    type PillFormHandle,
    type PillSlot,
} from "./PillForm";
import {
    displayCard,
    displayCardOpt,
    displayPassers,
    displayPlayer,
    displayPlayerOpt,
    isNobody,
    MultiSelectList,
    NOBODY,
    type Nobody,
    type Option,
    pillStatusForCard,
    pillStatusForPassers,
    pillStatusForPlayer,
    SingleSelectList,
} from "./SuggestionPills";

/**
 * Imperative handle exposed via `ref` so callers can drive focus
 * without baking global keyboard bindings into the form. Used by the
 * Add-suggestion mount to honour the Cmd+K shortcut.
 */
export interface SuggestionFormHandle {
    readonly focusFirstPill: (options?: { readonly clear?: boolean }) => void;
}

interface SuggestionFormProps {
    readonly setup: GameSetup;
    readonly suggestion?: DraftSuggestion;
    readonly onSubmit: (draft: DraftSuggestion) => void;
    readonly onCancel?: () => void;
    /** Hide the h3 title (used inline within an existing row). */
    readonly showHeader?: boolean;
    /** Hide the top-right "× Clear inputs" link. */
    readonly showClearInputs?: boolean;
    /**
     * Per-pill clear (×) affordance for the optional pills. Each flag,
     * when true AND the corresponding field has a value, renders a
     * tiny × on the pill chip itself (see `PillPopover.onClear`).
     */
    readonly pillClearable?: {
        readonly passers?: boolean;
        readonly refuter?: boolean;
        readonly seenCard?: boolean;
    };
    /**
     * Drives the submit button label and the disabled-tooltip phrasing.
     * Defaults to `"update"` when `suggestion` is provided, otherwise
     * `"add"`.
     */
    readonly submitLabel?: "add" | "update";
    /**
     * Optional outer element whose focus also counts as "in the form"
     * for Cmd+Enter. The inline-edit row passes its `<li>` ref here so
     * Cmd+Enter from anywhere in the row (including the row itself)
     * commits the draft. Each form keeps its own scope, so two forms
     * mounted at once never both fire on the same shortcut.
     */
    readonly keyboardScopeRef?: React.RefObject<HTMLElement | null>;
    /**
     * Fired after a successful submit, deferred via `setTimeout(_, 0)`
     * so the caller's `onSubmit` state changes (and any unmount they
     * trigger) have flushed first. Lets the caller place focus on an
     * element that survives the commit — e.g. the inline-edit row
     * refocuses its `<li>` here so the just-edited row keeps keyboard
     * context after the form unmounts.
     */
    readonly afterSubmit?: () => void;
}

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
export const SuggestionForm = forwardRef<
    SuggestionFormHandle,
    SuggestionFormProps
>(function SuggestionForm(
    {
        setup,
        suggestion,
        onSubmit,
        onCancel,
        showHeader = true,
        showClearInputs = true,
        pillClearable,
        submitLabel,
        keyboardScopeRef,
        afterSubmit,
    },
    ref,
): React.ReactElement {
    const effectiveSubmitLabel: "add" | "update" =
        // eslint-disable-next-line i18next/no-literal-string -- internal mode discriminator
        submitLabel ?? (suggestion !== undefined ? "update" : "add");
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
    const pillFormRef = useRef<PillFormHandle>(null);
    // Narrow `setOpenPillId` to `(next) => void` so PillForm's prop
    // type — which expects a value-only setter, not React's
    // `Dispatch<SetStateAction<T>>` overload — accepts it directly.
    const onOpenPillIdChange = useCallback(
        (next: OpenTarget) => setOpenPillId(next),
        [],
    );

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
                // `nextEnabledPill` is generic over the slot id (string);
                // narrow to PillId at the boundary so `isPillDisabledFor`
                // gets the typed key it expects.
                nextEnabledPill(pillSequence, from, id =>
                    isPillDisabledFor(next, id as PillId),
                ),
            );
        },
        [pillSequence],
    );

    // Per-pill open-change handlers (the close-timer race-guard) live
    // in `<PillForm>` now.

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
            return t(
                effectiveSubmitLabel === "update"
                    ? "submitDisabledFixErrorUpdate"
                    : "submitDisabledFixError",
                { fields: formatFieldList(fields) },
            );
        }
        const missing: Array<string> = [];
        if (form.suggester === null) missing.push(t("pillSuggester"));
        form.cards.forEach((c, i) => {
            if (c === null) {
                missing.push(setup.categories[i]?.name ?? `card-${i}`);
            }
        });
        if (missing.length === 0) return undefined;
        return t(
            effectiveSubmitLabel === "update"
                ? "submitDisabledFillInUpdate"
                : "submitDisabledFillIn",
            { fields: formatFieldList(missing) },
        );
    }, [
        canSubmit,
        errors,
        form,
        setup.categories,
        pillLabelFor,
        t,
        effectiveSubmitLabel,
    ]);

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
        if (afterSubmit !== undefined) {
            // Defer past React's commit (and any unmount the parent's
            // onSubmit triggered). setTimeout puts this on the
            // macrotask queue, so it always lands after the current
            // task's microtasks — including React's batched flush.
            setTimeout(afterSubmit, 0);
        }
    }, [canSubmit, draft, onSubmit, suggestion, setup, afterSubmit]);

    // Pill-to-pill keyboard nav (Tab + Arrow), Cmd+Enter submit, and
    // submit-button auto-focus all live in `<PillForm>` now.

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

    // Imperative handle: callers (e.g. AddSuggestion wiring up the
    // global Cmd+K shortcut) drive focus through `focusFirstPill`. The
    // form itself stays oblivious to global keyboard bindings.
    useImperativeHandle(
        ref,
        () => ({
            focusFirstPill: ({ clear } = {}) => {
                if (clear === true) setForm(emptyFormState(setup));
                setOpenPillId(PILL_SUGGESTER);
            },
        }),
        [setup],
    );

    // Per-pill clear callbacks for the optional pills. Wired into the
    // `pillClearable` prop — each callback resets that field (and any
    // dependent fields, e.g. clearing refuter must also clear seenCard
    // because PILL_SEEN becomes unreachable).
    const onClearPassers = useCallback(
        () => setForm(f => ({ ...f, nonRefuters: null })),
        [],
    );
    const onClearRefuter = useCallback(
        () => setForm(f => ({ ...f, refuter: null, seenCard: null })),
        [],
    );
    const onClearSeenCard = useCallback(
        () => setForm(f => ({ ...f, seenCard: null })),
        [],
    );

    // --- Slot configs --------------------------------------------------
    //
    // Build the per-pill `PillSlot` records that the shared
    // `<PillForm>` renders. Each slot's `content` is the popover body
    // (single- or multi-select list) — the closure captures the
    // current form snapshot so the commit handler can compute the
    // post-commit state and call `commitAndAdvance`.
    const slots: ReadonlyArray<PillSlot> = useMemo(() => {
        const suggesterSlot: PillSlot = {
            id: PILL_SUGGESTER,
            label: t("pillSuggester"),
            status: pillStatusForPlayer(form.suggester, false),
            valueDisplay: displayPlayer(form.suggester),
            ...(errorReasonFor(PILL_SUGGESTER) !== undefined
                ? { errorReason: errorReasonFor(PILL_SUGGESTER) }
                : {}),
            content: (
                <SingleSelectList<Player>
                    options={suggesterOptions(setup, form)}
                    selected={form.suggester}
                    onCommit={commitSuggester}
                    nobodyLabel={null}
                    nobodyValue={null}
                />
            ),
        };

        const cardSlots: ReadonlyArray<PillSlot> = setup.categories.map(
            (cat, i) => {
                const id = `card-${i}` as PillId;
                return {
                    id,
                    label: cat.name,
                    status: pillStatusForCard(form.cards[i] ?? null, false),
                    valueDisplay: displayCard(form.cards[i] ?? null, setup),
                    ...(errorReasonFor(id) !== undefined
                        ? { errorReason: errorReasonFor(id) }
                        : {}),
                    content: (
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
                    ),
                };
            },
        );

        const passersSlot: PillSlot = {
            id: PILL_PASSERS,
            label: t("pillPassers"),
            status: pillStatusForPassers(form.nonRefuters),
            valueDisplay: displayPassers(form.nonRefuters, t),
            ...(errorReasonFor(PILL_PASSERS) !== undefined
                ? { errorReason: errorReasonFor(PILL_PASSERS) }
                : {}),
            ...(pillClearable?.passers === true && form.nonRefuters !== null
                ? { onClear: onClearPassers }
                : {}),
            content: (
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
            ),
        };

        const refuterSlot: PillSlot = {
            id: PILL_REFUTER,
            label: t("pillRefuter"),
            status: pillStatusForPlayer(form.refuter, true),
            valueDisplay: displayPlayerOpt(form.refuter, t),
            ...(errorReasonFor(PILL_REFUTER) !== undefined
                ? { errorReason: errorReasonFor(PILL_REFUTER) }
                : {}),
            ...(pillClearable?.refuter === true && form.refuter !== null
                ? { onClear: onClearRefuter }
                : {}),
            content: (
                <SingleSelectList<Player>
                    options={refuterOptions(setup, form)}
                    selected={
                        isNobody(form.refuter) ? null : form.refuter
                    }
                    onCommit={commitRefuter}
                    nobodyLabel={t("popoverNobodyRefuted")}
                    nobodyValue={NOBODY}
                />
            ),
        };

        const seenSlot: PillSlot = {
            id: PILL_SEEN,
            label: t("pillSeen"),
            status: pillStatusForCard(form.seenCard, true),
            valueDisplay: displayCardOpt(form.seenCard, setup, t),
            disabled: isPillDisabled(PILL_SEEN),
            disabledHint: t("pillSeenDisabledHint"),
            ...(errorReasonFor(PILL_SEEN) !== undefined
                ? { errorReason: errorReasonFor(PILL_SEEN) }
                : {}),
            ...(pillClearable?.seenCard === true && form.seenCard !== null
                ? { onClear: onClearSeenCard }
                : {}),
            content: (
                <SingleSelectList<Card>
                    options={suggestedCardOptions(form, setup)}
                    selected={
                        isNobody(form.seenCard) ? null : form.seenCard
                    }
                    onCommit={commitSeenCard}
                    nobodyLabel={t("popoverNoShownCard")}
                    nobodyValue={NOBODY}
                />
            ),
        };

        return [
            suggesterSlot,
            ...cardSlots,
            passersSlot,
            refuterSlot,
            seenSlot,
        ];
    }, [
        form,
        setup,
        t,
        commitSuggester,
        commitCard,
        commitPassers,
        commitRefuter,
        commitSeenCard,
        errorReasonFor,
        isPillDisabled,
        onClearPassers,
        onClearRefuter,
        onClearSeenCard,
        pillClearable,
    ]);

    // --- Render --------------------------------------------------------
    const headerTitle = showHeader ? (
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
    ) : undefined;

    return (
        <PillForm
            ref={pillFormRef}
            slots={slots}
            pillSequence={pillSequence}
            openPillId={openPillId}
            onOpenPillIdChange={onOpenPillIdChange}
            canSubmit={canSubmit}
            submitLabel={t(
                effectiveSubmitLabel === "update" ? "updateAction" : "submit",
                { shortcut: label("action.submit") },
            )}
            {...(submitBlockReason !== undefined ? { submitBlockReason } : {})}
            onSubmit={doSubmit}
            {...(onCancel !== undefined
                ? { onCancel, cancelLabel: t("cancelAction") }
                : {})}
            {...(headerTitle !== undefined ? { headerTitle } : {})}
            {...(showClearInputs
                ? {
                      clearInputsLabel: t("clearInputs"),
                      hasAnyInput,
                      onClearInputs,
                  }
                : {})}
            {...(keyboardScopeRef !== undefined ? { keyboardScopeRef } : {})}
        />
    );
});

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


// PillId string literals are internal discriminators, never shown to
// the user. `OpenTarget` and `TARGET_SUBMIT` come from `PillForm`.

export const PILL_SUGGESTER: PillId = "suggester";
const PILL_PASSERS: PillId = "passers";
export const PILL_REFUTER: PillId = "refuter";
export const PILL_SEEN: PillId = "seenCard";

const buildPillSequence = (setup: GameSetup): ReadonlyArray<PillId> => {
    const ids: Array<PillId> = [PILL_SUGGESTER];
    for (let i = 0; i < setup.categories.length; i++) {
        ids.push(`card-${i}` as PillId);
    }
    ids.push(PILL_PASSERS, PILL_REFUTER, PILL_SEEN);
    return ids;
};

// `nextPill` / `prevPill` (Tab/Arrow nav) live in `<PillForm>` now.

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
type PillErrorCode =
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

