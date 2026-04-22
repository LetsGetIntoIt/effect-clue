"use client";

import * as RadixPopover from "@radix-ui/react-popover";
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
import { Tooltip } from "./Tooltip";

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

    // --- Platform detection for submit modifier (SSR-safe) ---
    //
    // Mac uses ⌘ (metaKey), Windows / Linux use Ctrl (ctrlKey). The
    // key handler accepts either modifier regardless of detected
    // platform, so misconfigured machines aren't locked out —
    // detection only drives display copy.
    const [isMac, setIsMac] = useState(false);
    useEffect(() => {
        if (typeof navigator === "undefined") return;
        setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
    }, []);
    const platformKey = isMac ? PLATFORM_MAC : PLATFORM_OTHER;

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
        (id: PillId): boolean => {
            if (id === PILL_SEEN) {
                // Shown-card requires a resolved refuter. "Nobody
                // refuted" or unresolved refuter both disable it.
                return form.refuter === null || isNobody(form.refuter);
            }
            return false;
        },
        [form.refuter],
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

    const openNextPillAfter = useCallback(
        (current: PillId) => {
            setOpenPillId(
                nextEnabledPill(pillSequence, current, isPillDisabled),
            );
        },
        [pillSequence, isPillDisabled],
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
    // shape is uniform: update state, then advance. Passers commit
    // differently (Enter confirms the multi-select) — see
    // MultiSelectList below.
    // Required pill callbacks widen to accept `Nobody` because the
    // SingleSelectList generic can't statically know that required
    // pills omit the Nobody row. At runtime we never call them with
    // NOBODY (the list's `nobodyValue={null}` suppresses that row),
    // but the early-return guards give TypeScript the narrow it
    // needs.
    const commitSuggester = useCallback(
        (value: Player | Nobody) => {
            if (isNobody(value)) return;
            setForm(s => ({ ...s, suggester: value }));
            openNextPillAfter(PILL_SUGGESTER);
        },
        [openNextPillAfter],
    );
    const commitCard = useCallback(
        (index: number, value: Card | Nobody) => {
            if (isNobody(value)) return;
            setForm(s => {
                const next = s.cards.slice();
                next[index] = value;
                return { ...s, cards: next };
            });
            openNextPillAfter(`card-${index}` as PillId);
        },
        [openNextPillAfter],
    );
    const commitPassers = useCallback(
        (
            value: ReadonlyArray<Player> | Nobody,
            opts: { advance: boolean } = { advance: true },
        ) => {
            setForm(s => ({ ...s, nonRefuters: value }));
            if (opts.advance) openNextPillAfter(PILL_PASSERS);
        },
        [openNextPillAfter],
    );
    const commitRefuter = useCallback(
        (value: Player | Nobody) => {
            setForm(s => ({
                ...s,
                refuter: value,
                // If the refuter changed to "nobody" (or away from a
                // previously-resolved player to a different resolved
                // player), the old seen-card is no longer valid.
                seenCard: isNobody(value)
                    ? null
                    : s.seenCard !== null &&
                        !isNobody(s.seenCard) &&
                        !suggestedCards(s).some(c => c === s.seenCard)
                      ? null
                      : s.seenCard,
            }));
            openNextPillAfter(PILL_REFUTER);
        },
        [openNextPillAfter],
    );
    const commitSeenCard = useCallback(
        (value: Card | Nobody) => {
            setForm(s => ({ ...s, seenCard: value }));
            openNextPillAfter(PILL_SEEN);
        },
        [openNextPillAfter],
    );

    // --- Submit --------------------------------------------------------
    const draft = useMemo(() => buildDraftFromForm(form), [form]);
    const canSubmit = draft !== null;

    const doSubmit = useCallback(() => {
        if (draft === null) return;
        onSubmit(draft);
        // Add-flow: reset and return to the first pill.
        // Edit-flow: the parent unmounts us via onCancel-equivalent
        // after it processes the update, so resetting is harmless.
        if (suggestion === undefined) {
            setForm(emptyFormState(setup));
            setOpenPillId(PILL_SUGGESTER);
        }
    }, [draft, onSubmit, suggestion, setup]);

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
            if (e.key !== "Enter") return;
            if (!(e.metaKey || e.ctrlKey)) return;
            // Only handle if focus is inside our form root or in any
            // Radix portal popover owned by our form (we check by
            // walking up from the focused element).
            const active = document.activeElement as Element | null;
            const root = formRootRef.current;
            if (
                !root ||
                !active ||
                !(root.contains(active) || isInsideOwnPopover(active))
            ) {
                return;
            }
            e.preventDefault();
            doSubmit();
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [doSubmit]);

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
                              platform: platformKey,
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
                  * (px-2 py-0.5 text-[12px]) but keeps the default
                  * `rounded` radius instead of `rounded-full`, so it
                  * reads as a squared-off primary action distinct from
                  * the round pills.
                  */}
                <button
                    type="button"
                    ref={submitBtnRef}
                    className="cursor-pointer rounded border-none bg-accent px-2 py-0.5 text-[12px] text-white disabled:cursor-not-allowed disabled:bg-unknown"
                    disabled={!canSubmit}
                    onClick={doSubmit}
                >
                    {t("submit", { platform: platformKey })}
                </button>
                {onCancel !== undefined && (
                    <button
                        type="button"
                        className="cursor-pointer rounded border border-border bg-white px-2 py-0.5 text-[12px]"
                        onClick={onCancel}
                    >
                        {t("cancelAction")}
                    </button>
                )}
            </div>
        </div>
    );
}

// ---- Platform discriminators (not user copy) ---------------------------

 
// ICU `select` keys for the submit / addTitle templates in
// messages/en.json. Must match the string literals in those messages
// exactly.
const PLATFORM_MAC = "mac";
const PLATFORM_OTHER = "other";
 

// ---- "Nobody" sentinel ------------------------------------------------

/**
 * Explicit "no one / no card" marker for optional slots. Distinct
 * from `null` ("not decided yet"): `NOBODY` means the user made an
 * active choice not to name anyone, so the pill renders with a `✓`
 * rather than the dashed-outline optional-empty style.
 *
 * A frozen object sentinel keeps the type distinct from the
 * branded-string Player / Card values under TypeScript's structural
 * equality — `symbol` would have worked at runtime but TS widens
 * `unique symbol` to `symbol` through generic parameters, which
 * sheds the distinction.
 */
const NOBODY = Object.freeze({ kind: "nobody" as const });
type Nobody = typeof NOBODY;

/**
 * Narrowing type guard. TS can't predicate-narrow via plain
 * reference equality (`value === NOBODY`) with an object sentinel
 * because object identity isn't reflected at the type level. This
 * guard makes the refinement explicit.
 */
const isNobody = (v: unknown): v is Nobody => v === NOBODY;

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

type PillId =
    | "suggester"
    | `card-${number}`
    | "passers"
    | "refuter"
    | "seenCard";

 
// PillId + OpenTarget string literals are internal discriminators,
// never shown to the user. They drive the auto-advance state
// machine; keeping them as raw strings makes the code readable.
type OpenTarget = PillId | "submit" | null;

const PILL_SUGGESTER: PillId = "suggester";
const PILL_PASSERS: PillId = "passers";
const PILL_REFUTER: PillId = "refuter";
const PILL_SEEN: PillId = "seenCard";
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
 * Check whether an element lives inside a popover owned by this
 * form. Radix popovers render through a portal, so they aren't
 * contained by our root `<div>`. We tag each popover content with
 * `data-suggestion-form-popover` so the document-level Cmd+Enter
 * listener can distinguish our popovers from unrelated ones
 * (Tooltips, future popovers from other components, etc.).
 */
const isInsideOwnPopover = (el: Element): boolean =>
    el.closest("[data-suggestion-form-popover='true']") !== null;

// ---- Candidate list helpers ------------------------------------------

interface Option<T> {
    readonly value: T;
    readonly label: string;
}

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

// ---- Pill status + display ------------------------------------------

 
type PillStatus = "done" | "pendingRequired" | "pendingOptional" | "error";
const STATUS_DONE: PillStatus = "done";
const STATUS_PENDING_REQ: PillStatus = "pendingRequired";
const STATUS_PENDING_OPT: PillStatus = "pendingOptional";
 

const pillStatusForPlayer = (
    value: Player | Nobody | null,
    optional: boolean,
): PillStatus =>
    value === null
        ? optional
            ? STATUS_PENDING_OPT
            : STATUS_PENDING_REQ
        : STATUS_DONE;

const pillStatusForCard = (
    value: Card | Nobody | null,
    optional: boolean,
): PillStatus =>
    value === null
        ? optional
            ? STATUS_PENDING_OPT
            : STATUS_PENDING_REQ
        : STATUS_DONE;

const pillStatusForPassers = (
    value: ReadonlyArray<Player> | Nobody | null,
): PillStatus =>
    value === null
        ? STATUS_PENDING_OPT
        : Array.isArray(value) && value.length === 0
          ? STATUS_PENDING_OPT
          : STATUS_DONE;

const displayPlayer = (value: Player | null): string | undefined =>
    value === null ? undefined : String(value);

const displayCard = (
    value: Card | null,
    setup: GameSetup,
): string | undefined => {
    if (value === null) return undefined;
    for (const cat of setup.categories) {
        const entry = cat.cards.find(e => e.id === value);
        if (entry !== undefined) return entry.name;
    }
    return String(value);
};

type TFn = (key: string, values?: Record<string, string>) => string;

// Pill value-chip text ("...: nobody" / "...: unknown") is
// intentionally shorter than the popover row label ("Nobody
// refuted", "Unknown / unseen"). The pill's own label already
// supplies the context ("Refuted by:", "Shown card:") so the chip
// only needs the noun.
const displayPlayerOpt = (
    value: Player | Nobody | null,
    t: TFn,
): string | undefined => {
    if (value === null) return undefined;
    if (isNobody(value)) return t("pillValueNobody");
    return String(value);
};

const displayCardOpt = (
    value: Card | Nobody | null,
    setup: GameSetup,
    t: TFn,
): string | undefined => {
    if (value === null) return undefined;
    if (isNobody(value)) return t("pillValueUnknown");
    return displayCard(value, setup);
};

const displayPassers = (
    value: ReadonlyArray<Player> | Nobody | null,
    t: TFn,
): string | undefined => {
    if (value === null) return undefined;
    if (isNobody(value)) return t("pillValueNobody");
    if (value.length === 0) return undefined;
    return Array.from(new Set(value.map(String))).join(", ");
};

// ---- PillPopover — pill body + Radix wrapper + hover grace ----------

/**
 * One pill + its popover, bound together. The pill itself is the
 * Radix Popover Trigger; the candidate list lives inside Radix
 * Popover Content (portalled to `document.body`).
 *
 * Hover behaviour:
 *   - pointerEnter on either the trigger or the content opens the
 *     popover and cancels any pending close.
 *   - pointerLeave on either schedules a close after 150ms. The
 *     grace window lets the user move the pointer between the pill
 *     and its popover without the menu winking out.
 *   - focus + Enter / Space / click on the trigger also open.
 *   - Esc / outside-click close (Radix default).
 */
function PillPopover({
    pillId,
    label,
    status,
    valueDisplay,
    disabled,
    disabledHint,
    open,
    onOpenChange,
    children,
}: {
    readonly pillId: PillId;
    readonly label: string;
    readonly status: PillStatus;
    readonly valueDisplay: string | undefined;
    readonly disabled?: boolean;
    readonly disabledHint?: string;
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly children: React.ReactNode;
}): React.ReactElement {
    // Pill visual classes by status. Required vs. optional is
    // distinguished by the OUTLINE style (solid vs. dashed) — NOT by
    // the icon. Both empty-required and empty-optional pills show a
    // `+` glyph to invite the user to fill them in. A disabled
    // optional pill (e.g. Shown card without a refuter) fades and
    // swaps to `–` to signal it's currently unavailable.
    //
    // Matrix:
    //   status            | outline       | icon
    //   ------------------+---------------+-----
    //   done              | solid accent  | ✓
    //   pendingRequired   | solid border  | +
    //   pendingOptional   | dashed border | +      (disabled → "–")
    //   error (reserved)  | danger        | !
    const tone =
        status === STATUS_DONE
            ? "bg-accent text-white border-accent"
            : status === STATUS_PENDING_REQ
              ? "bg-transparent text-muted border-border"
              : disabled
                ? "bg-transparent text-muted/60 border-dashed border-border/50 cursor-not-allowed"
                : "bg-transparent text-muted border-dashed border-border";
    const iconGlyph =
        status === STATUS_DONE
            ? "✓"
            : status === STATUS_PENDING_OPT && disabled
              ? "–"
              : "+";
    const pillBody = (
        <span
            className={
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] " +
                tone
            }
        >
            <span
                aria-hidden
                className="inline-block w-3 text-center text-[10px] leading-3"
            >
                {iconGlyph}
            </span>
            <span className="font-semibold">{label}</span>
            {valueDisplay !== undefined && (
                <span className="font-normal">: {valueDisplay}</span>
            )}
        </span>
    );

    if (disabled) {
        // Disabled: don't mount the popover at all. Render the pill
        // as a span so hover can still surface the disabledHint
        // tooltip via the project Tooltip wrapper.
        return (
            <Tooltip content={disabledHint}>
                <span className="cursor-not-allowed">{pillBody}</span>
            </Tooltip>
        );
    }

    return (
        <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
            <RadixPopover.Trigger
                data-pill-id={pillId}
                className="cursor-pointer rounded-full border-none bg-transparent p-0 hover:opacity-80"
            >
                {pillBody}
            </RadixPopover.Trigger>
            <RadixPopover.Portal>
                <RadixPopover.Content
                    data-suggestion-form-popover="true"
                    sideOffset={6}
                    collisionPadding={8}
                    onOpenAutoFocus={e => {
                        // Let our own list focus its first option —
                        // Radix's default is "focus the content
                        // container" which traps arrow keys.
                        e.preventDefault();
                    }}
                    onCloseAutoFocus={e => {
                        // Prevent Radix from returning focus to the
                        // trigger on close. That default steals
                        // focus from the *next* popover's list
                        // during auto-advance (the list's mount
                        // effect focused it; Radix's focus-return
                        // fires later and undoes that).
                        e.preventDefault();
                    }}
                    onInteractOutside={e => {
                        // Auto-advance triggers a stray "outside
                        // interaction" on the newly-opened popover
                        // (as the prior one unmounts). Swallow the
                        // close only when the interaction's target
                        // is another pill trigger or another of our
                        // popovers — anything genuinely outside the
                        // form still closes naturally via Radix.
                        const target = e.target as Element | null;
                        if (
                            target !== null &&
                            target.closest(
                                "[data-pill-id],[data-suggestion-form-popover='true']",
                            ) !== null
                        ) {
                            e.preventDefault();
                        }
                    }}
                    className="z-50 min-w-[200px] rounded-[var(--radius)] border border-border bg-panel p-1 text-[13px] shadow-[0_6px_16px_rgba(0,0,0,0.18)]"
                >
                    {children}
                </RadixPopover.Content>
            </RadixPopover.Portal>
        </RadixPopover.Root>
    );
}

// ---- SingleSelectList ------------------------------------------------

/**
 * Keyboard-driven single-select list for popover content.
 *
 *   Up / Down — move focus
 *   Enter / Space — commit highlighted option (or Nobody row)
 *   Home / End — jump to first / last
 *
 * Auto-focuses the currently-selected option on mount (or the first
 * option if nothing is selected yet). `nobodyLabel` + `nobodyValue`
 * add a trailing "none" row for optional slots; pass `null` for both
 * to omit.
 */
function SingleSelectList<T>({
    options,
    selected,
    onCommit,
    nobodyLabel,
    nobodyValue,
}: {
    readonly options: ReadonlyArray<Option<T>>;
    readonly selected: T | null;
    readonly onCommit: (value: T | Nobody) => void;
    readonly nobodyLabel: string | null;
    readonly nobodyValue: Nobody | null;
}): React.ReactElement {
    // Rows: options + an optional "nobody" terminal row.
    const rows = useMemo<
        ReadonlyArray<
            | { readonly kind: "option"; readonly option: Option<T> }
            | {
                  readonly kind: "nobody";
                  readonly label: string;
                  readonly value: Nobody;
              }
        >
    >(
        () => [
            ...options.map(o => ({ kind: "option" as const, option: o })),
            ...(nobodyLabel !== null && nobodyValue !== null
                ? [
                      {
                          kind: "nobody" as const,
                          label: nobodyLabel,
                          value: nobodyValue,
                      },
                  ]
                : []),
        ],
        [options, nobodyLabel, nobodyValue],
    );

    const initialIdx = useMemo(() => {
        if (selected !== null) {
            const idx = options.findIndex(o => o.value === selected);
            if (idx >= 0) return idx;
        }
        return 0;
    }, [selected, options]);
    const [focusedIdx, setFocusedIdx] = useState(initialIdx);

    const listRef = useRef<HTMLUListElement>(null);
    useEffect(() => {
        listRef.current?.focus();
    }, []);

    const commitAt = useCallback(
        (i: number) => {
            const row = rows[i];
            if (row === undefined) return;
            if (row.kind === "option") onCommit(row.option.value);
            else onCommit(row.value);
        },
        [rows, onCommit],
    );

    const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setFocusedIdx(i => (i + 1) % Math.max(rows.length, 1));
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            setFocusedIdx(i =>
                (i - 1 + rows.length) % Math.max(rows.length, 1),
            );
            return;
        }
        if (e.key === "Home") {
            e.preventDefault();
            setFocusedIdx(0);
            return;
        }
        if (e.key === "End") {
            e.preventDefault();
            setFocusedIdx(Math.max(rows.length - 1, 0));
            return;
        }
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            commitAt(focusedIdx);
            return;
        }
    };

    return (
        <ul
            ref={listRef}
            role="listbox"
            tabIndex={0}
            onKeyDown={onKeyDown}
            className="m-0 max-h-[240px] list-none overflow-y-auto p-0 outline-none"
        >
            {rows.map((row, i) => {
                const isSelected =
                    row.kind === "option"
                        ? row.option.value === selected
                        : selected === null && nobodyValue !== null;
                const highlighted = i === focusedIdx;
                return (
                    <li
                        key={i}
                        role="option"
                        aria-selected={isSelected}
                        className={
                            "flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[13px]" +
                            (highlighted ? " bg-accent/15" : "") +
                            (row.kind === "nobody"
                                ? " border-t border-border/60 text-muted"
                                : "")
                        }
                        onMouseEnter={() => setFocusedIdx(i)}
                        onMouseDown={e => {
                            e.preventDefault();
                            commitAt(i);
                        }}
                    >
                        {row.kind === "option" ? row.option.label : row.label}
                    </li>
                );
            })}
        </ul>
    );
}

// ---- MultiSelectList -------------------------------------------------

/**
 * Keyboard-driven multi-select list for the passers popover.
 *
 *   Up / Down — move focus
 *   Space — toggle focused option
 *   Enter — commit current set and advance to the next pill
 *   Esc / click-outside — commit current set WITHOUT advancing
 *
 * Commit-on-close semantics: the popover accumulates toggles locally
 * (unlike single-select which commits on the first click). Any way
 * of closing the popover — Enter, Esc, outside click, clicking
 * another pill — persists what was toggled so far. The difference
 * between Enter and the other close paths is whether we advance to
 * the next pill: Enter advances, the other paths just commit.
 *
 * A terminal "Nobody passed" radio-style row clears all toggles and
 * records the explicit NOBODY sentinel immediately.
 */
function MultiSelectList({
    options,
    selected,
    nobodyChosen,
    nobodyLabel,
    commitHint,
    onCommit,
}: {
    readonly options: ReadonlyArray<Option<Player>>;
    readonly selected: ReadonlyArray<Player>;
    readonly nobodyChosen: boolean;
    readonly nobodyLabel: string;
    readonly commitHint: string;
    readonly onCommit: (
        value: ReadonlyArray<Player> | Nobody,
        opts?: { advance: boolean },
    ) => void;
}): React.ReactElement {
    const [toggled, setToggled] = useState<ReadonlyArray<Player>>(selected);
    const [focusedIdx, setFocusedIdx] = useState(0);
    const listRef = useRef<HTMLUListElement>(null);
    useEffect(() => {
        listRef.current?.focus();
    }, []);

    // On unmount, persist the toggled set without advancing. Covers
    // Esc, outside-click, and clicking another pill. `committedRef`
    // is set by the Enter / Nobody commit paths to skip this cleanup
    // so those don't double-commit.
    const toggledRef = useRef<ReadonlyArray<Player>>(toggled);
    toggledRef.current = toggled;
    const committedRef = useRef(false);
    // On unmount only — we deliberately capture the latest toggled
    // set via `toggledRef`, so this effect doesn't need `onCommit`
    // in its deps.
    useEffect(
        () => () => {
            if (committedRef.current) return;
            onCommit(toggledRef.current, { advance: false });
        },
        [onCommit],
    );
    const commitAdvance = (
        value: ReadonlyArray<Player> | Nobody,
    ): void => {
        committedRef.current = true;
        onCommit(value);
    };

    const rowCount = options.length + 1; // + "nobody" row
    const isNobodyRow = (i: number) => i === options.length;

    const toggle = (player: Player) => {
        setToggled(prev =>
            prev.some(p => p === player)
                ? prev.filter(p => p !== player)
                : [...prev, player],
        );
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setFocusedIdx(i => (i + 1) % rowCount);
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            setFocusedIdx(i => (i - 1 + rowCount) % rowCount);
            return;
        }
        if (e.key === "Home") {
            e.preventDefault();
            setFocusedIdx(0);
            return;
        }
        if (e.key === "End") {
            e.preventDefault();
            setFocusedIdx(rowCount - 1);
            return;
        }
        if (e.key === " ") {
            e.preventDefault();
            if (isNobodyRow(focusedIdx)) {
                // Commit NOBODY immediately + advance — it's a
                // mutually exclusive choice with any toggled players.
                commitAdvance(NOBODY);
                return;
            }
            const opt = options[focusedIdx];
            if (opt !== undefined) toggle(opt.value);
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            if (isNobodyRow(focusedIdx)) {
                commitAdvance(NOBODY);
            } else {
                commitAdvance(toggled);
            }
            return;
        }
    };

    return (
        <div>
            <ul
                ref={listRef}
                role="listbox"
                aria-multiselectable
                tabIndex={0}
                onKeyDown={onKeyDown}
                className="m-0 max-h-[240px] list-none overflow-y-auto p-0 outline-none"
            >
                {options.map((opt, i) => {
                    const checked = toggled.some(p => p === opt.value);
                    const highlighted = i === focusedIdx;
                    return (
                        <li
                            key={String(opt.value)}
                            role="option"
                            aria-selected={checked}
                            className={
                                "flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[13px]" +
                                (highlighted ? " bg-accent/15" : "")
                            }
                            onMouseEnter={() => setFocusedIdx(i)}
                            onMouseDown={e => {
                                e.preventDefault();
                                toggle(opt.value);
                            }}
                        >
                            <span
                                aria-hidden
                                className={
                                    "inline-block h-3.5 w-3.5 rounded-sm border text-center text-[10px] leading-3 " +
                                    (checked
                                        ? "border-accent bg-accent text-white"
                                        : "border-border bg-transparent text-transparent")
                                }
                            >
                                {checked ? "✓" : ""}
                            </span>
                            {opt.label}
                        </li>
                    );
                })}
                <li
                    role="option"
                    aria-selected={nobodyChosen}
                    className={
                        "flex cursor-pointer items-center gap-1.5 rounded border-t border-border/60 px-2 py-1 text-[13px] text-muted" +
                        (focusedIdx === options.length
                            ? " bg-accent/15"
                            : "")
                    }
                    onMouseEnter={() => setFocusedIdx(options.length)}
                    onMouseDown={e => {
                        e.preventDefault();
                        commitAdvance(NOBODY);
                    }}
                >
                    {nobodyLabel}
                </li>
            </ul>
            <div className="mt-1 flex items-center justify-between gap-2 px-2 py-1 text-[11px] text-muted">
                <span>{commitHint}</span>
                <button
                    type="button"
                    className="cursor-pointer rounded border border-border bg-white px-2 py-0.5 text-[11px]"
                    onMouseDown={e => {
                        e.preventDefault();
                        commitAdvance(toggled);
                    }}
                >
                    OK
                </button>
            </div>
        </div>
    );
}

