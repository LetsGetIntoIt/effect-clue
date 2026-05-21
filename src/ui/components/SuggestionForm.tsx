"use client";

import { Result } from "effect";
import { useTranslations } from "next-intl";
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from "react";
import {
    SOLVER_MODE_SOLVE,
    type DraftSuggestion,
    type PendingSuggestionDraft,
    type SolverMode,
} from "../../logic/ClueState";
import type { GameSetup } from "../../logic/GameSetup";
import { categoryOfCard } from "../../logic/GameSetup";
import type { Card, Player } from "../../logic/GameObjects";
import type { Knowledge } from "../../logic/Knowledge";
import {
    classifyRefuteCandidates,
    type RefuteAdviceCandidate,
    type RefuteAdviceTier,
} from "../../logic/RefuteAdvice";
import {
    computeRefuteEvidence,
    playerCellValue,
    type RefuteEvidence,
} from "../../logic/RefuteEvidence";
import { newSuggestionId } from "../../logic/Suggestion";
import { useHasKeyboard } from "../hooks/useHasKeyboard";
import { label, shortcutSuffix } from "../keyMap";
import { useClueOptional } from "../state";
import { AlertIcon } from "./Icons";
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
    /**
     * Reset every pill to empty. Used by the section-header X button
     * (in `AddSuggestion`) to clear the form without re-mounting it.
     */
    readonly clearInputs: () => void;
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
    /**
     * Persisted draft to seed from on mount, and to mirror back to
     * via `onPendingDraftChange` on every change. New-suggestion
     * flow only — the edit-existing flow already has a saved
     * source-of-truth in `state.suggestions` and ignores both fields.
     *
     * Both must be provided together: passing `pendingDraft` without
     * `onPendingDraftChange` would seed a draft that the form then
     * silently mutates locally without persisting. Passing the
     * callback alone is allowed — it just means the form starts
     * empty and writes its first state through.
     */
    readonly pendingDraft?: PendingSuggestionDraft | null;
    readonly onPendingDraftChange?: (
        draft: PendingSuggestionDraft | null,
    ) => void;
    /**
     * Notify the parent whenever the form transitions between empty
     * and "has at least one filled slot." Drives the section-header
     * "Add a suggestion / accusation" copy + clear-inputs X button.
     */
    readonly onHasAnyInputChange?: (hasAnyInput: boolean) => void;
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
        pendingDraft,
        onPendingDraftChange,
        onHasAnyInputChange,
    },
    ref,
): React.ReactElement {
    const effectiveSubmitLabel: "add" | "update" =
        // eslint-disable-next-line i18next/no-literal-string -- internal mode discriminator
        submitLabel ?? (suggestion !== undefined ? "update" : "add");
    const t = useTranslations("suggestions");
    const hasKeyboard = useHasKeyboard();

    // --- Form state ----------------------------------------------------
    const isEditFlow = suggestion !== undefined;
    const [form, setForm] = useState<FormState>(() => {
        if (suggestion !== undefined) {
            return formStateFromDraft(suggestion, setup);
        }
        // New-suggestion flow: seed from a persisted pending draft when
        // the parent supplies one and it's structurally compatible
        // with the current setup (same number of card slots; ref-only
        // shape match — the reducer drops the whole draft on setup
        // changes, so getting here with a stale draft is rare).
        if (
            pendingDraft !== undefined
            && pendingDraft !== null
            && pendingDraft.cards.length === setup.categories.length
        ) {
            return pendingDraft;
        }
        return emptyFormState(setup);
    });

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

    // Mirror new-suggestion form state into the parent on every change
    // so a mount/unmount cycle (mobile tab swap, full reload) survives.
    // Edit flow has its own saved source-of-truth and skips the mirror.
    //
    // The callback is held behind a ref so a non-memoized parent
    // doesn't re-run the effect every render — the mirror should fire
    // when `form` changes, not when `onPendingDraftChange`'s identity
    // does.
    const onPendingDraftChangeRef = useRef(onPendingDraftChange);
    useEffect(() => {
        onPendingDraftChangeRef.current = onPendingDraftChange;
    });
    const initialMirrorRef = useRef(true);
    useEffect(() => {
        if (isEditFlow) return;
        if (initialMirrorRef.current) {
            initialMirrorRef.current = false;
            return;
        }
        // Mirror null when the form is back to its empty default —
        // submit-success and "× Clear inputs" both reset the form,
        // and we don't want a stale empty draft re-seeding the next
        // mount.
        onPendingDraftChangeRef.current?.(isEmptyFormState(form) ? null : form);
    }, [form, isEditFlow]);

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
                applySuggesterMove(form, value),
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
            const next = applyPassersMove(form, value);
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
            // applyRefuterMove handles clearing seenCard when refuter
            // becomes NOBODY (otherwise the shown-card pill turns
            // unreachable and a stale value would strand). When
            // refuter switches to a different resolved player, seenCard
            // is preserved — if it's no longer in the suggested cards,
            // the error-state surfaces the mismatch in PILL_SEEN.
            commitAndAdvance(
                applyRefuterMove(form, value),
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

    // --- Help layer (badges + soft validation) ------------------------
    //
    // The hook + validator both gracefully degrade to "inactive / empty"
    // when `<ClueProvider>` is absent (test environments) or teach-me
    // mode is on — call sites don't need conditional branches.
    const help = useRefuteHelp(form);
    const clueCtx = useClueOptional();
    const warnings = useMemo<ReadonlyMap<PillId, SoftWarning>>(
        () =>
            validateFormSoft(form, {
                knowledge:
                    clueCtx !== undefined &&
                    Result.isSuccess(clueCtx.derived.deductionResult)
                        ? clueCtx.derived.deductionResult.success
                        : undefined,
                selfPlayerId: clueCtx?.state.selfPlayerId ?? null,
                solverMode: clueCtx?.state.solverMode ?? SOLVER_MODE_SOLVE,
                categoryCount: setup.categories.length,
            }),
        [form, clueCtx, setup.categories.length],
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

    const selfPlayerId = clueCtx?.state.selfPlayerId ?? null;
    const warningMessageFor = useCallback(
        (warning: SoftWarning): string => {
            switch (warning.kind) {
                case "passersIncludePlayersWhoCanRefute": {
                    if (warning.players.length === 1) {
                        const offender = warning.players[0];
                        if (offender === undefined) return "";
                        return offender === selfPlayerId
                            ? t("pillWarningPassersIncludeSelfCanRefute")
                            : t("pillWarningPassersIncludePlayerCanRefute", {
                                  player: String(offender),
                              });
                    }
                    const labels = warning.players.map(p =>
                        p === selfPlayerId
                            ? t("playerLabelSelfSubject")
                            : String(p),
                    );
                    return t("pillWarningPassersIncludePlayersCanRefute", {
                        players: formatFieldList(labels),
                    });
                }
                case "refuterCannotRefute":
                    return warning.player === selfPlayerId
                        ? t("pillWarningSelfRefuterNoMatch")
                        : t("pillWarningRefuterCannotRefute", {
                              player: String(warning.player),
                          });
                case "shownCardNotInRefuterHand":
                    return warning.player === selfPlayerId
                        ? t("pillWarningShownCardNotInHand")
                        : t("pillWarningShownCardNotInRefuterHand", {
                              player: String(warning.player),
                          });
            }
        },
        [t, selfPlayerId],
    );

    const warningReasonFor = useCallback(
        (id: PillId): string | undefined => {
            const w = warnings.get(id);
            return w === undefined ? undefined : warningMessageFor(w);
        },
        [warnings, warningMessageFor],
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
        // Stamp the draft with the right loggedAt before handing off:
        // edit-mode preserves the original (so re-ordering doesn't
        // happen on re-save), add-mode mints `Date.now()` so the
        // combined prior-log sees this entry as the most recent.
        const submittable: DraftSuggestion = {
            ...draft,
            loggedAt: suggestion?.loggedAt ?? Date.now(),
        };
        onSubmit(submittable);
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

    // Mirror the empty-vs-non-empty boolean to the parent. Held behind
    // a ref (matching the `onPendingDraftChange` pattern) so the effect
    // doesn't re-fire when the callback's identity changes.
    const onHasAnyInputChangeRef = useRef(onHasAnyInputChange);
    useEffect(() => {
        onHasAnyInputChangeRef.current = onHasAnyInputChange;
    });
    useEffect(() => {
        onHasAnyInputChangeRef.current?.(hasAnyInput);
    }, [hasAnyInput]);

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
            clearInputs: onClearInputs,
        }),
        [setup, onClearInputs],
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

    // --- Help-layer badge renderers -----------------------------------
    //
    // Every player row in Suggester / Passers / Refuter first checks
    // for a cross-role hard conflict — picking that option WOULD land
    // a `validateFormConsistency` error on the pill, so we surface the
    // role label BEFORE selection. Without a conflict, fall back to
    // soft `help.evidenceByPlayer` ("Can refute" / "Cannot refute").
    //
    // The CHIP STYLE is governed by `BadgeElevation`: every option is
    // muted until the pill itself is in the matching error / warning
    // state due to THIS option being committed. Then the chip elevates
    // to error / warning, in lockstep with the pill. Precedence
    // matches the pill: error > warning > muted.
    //
    // Returns `null` when there's no informational text to show.

    /* eslint-disable i18next/no-literal-string -- internal pill-error-code and elevation-tag values, not user-facing copy */
    const elevationForSuggester = useCallback(
        (player: Player): BadgeElevation => {
            const code = errors.get(PILL_SUGGESTER);
            if (
                (code === "suggesterIsRefuter" ||
                    code === "suggesterInPassers") &&
                player === form.suggester
            ) {
                return "error";
            }
            return "muted";
        },
        [errors, form.suggester],
    );

    const elevationForPasser = useCallback(
        (player: Player): BadgeElevation => {
            const code = errors.get(PILL_PASSERS);
            if (code === "suggesterInPassers" && player === form.suggester) {
                return "error";
            }
            if (code === "refuterInPassers" && player === form.refuter) {
                return "error";
            }
            const w = warnings.get(PILL_PASSERS);
            if (
                w !== undefined &&
                w.kind === "passersIncludePlayersWhoCanRefute" &&
                w.players.some(p => p === player)
            ) {
                return "warning";
            }
            return "muted";
        },
        [errors, warnings, form.suggester, form.refuter],
    );

    const elevationForRefuter = useCallback(
        (player: Player): BadgeElevation => {
            const code = errors.get(PILL_REFUTER);
            if (
                (code === "suggesterIsRefuter" ||
                    code === "refuterInPassers") &&
                player === form.refuter
            ) {
                return "error";
            }
            const w = warnings.get(PILL_REFUTER);
            if (
                w !== undefined &&
                w.kind === "refuterCannotRefute" &&
                player === form.refuter
            ) {
                return "warning";
            }
            return "muted";
        },
        [errors, warnings, form.refuter],
    );

    const elevationForShownCard = useCallback(
        (card: Card): BadgeElevation => {
            const code = errors.get(PILL_SEEN);
            if (
                (code === "seenCardNotSuggested" ||
                    code === "seenCardWithoutRefuter") &&
                card === form.seenCard
            ) {
                return "error";
            }
            const w = warnings.get(PILL_SEEN);
            if (
                w !== undefined &&
                w.kind === "shownCardNotInRefuterHand" &&
                card === form.seenCard
            ) {
                return "warning";
            }
            return "muted";
        },
        [errors, warnings, form.seenCard],
    );
    /* eslint-enable i18next/no-literal-string */

    const renderSuggesterBadge = useCallback(
        (player: Player): ReactNode => {
            const conflict = findHardRoleConflict(
                player,
                form,
                // eslint-disable-next-line i18next/no-literal-string -- internal role tag
                "suggester",
            );
            if (conflict !== null) {
                return renderHardRoleConflictBadge(
                    conflict,
                    t,
                    elevationForSuggester(player),
                );
            }
            return null;
        },
        [form, t, elevationForSuggester],
    );
    const renderPasserBadge = useCallback(
        (player: Player): ReactNode => {
            const elevation = elevationForPasser(player);
            const conflict = findHardRoleConflict(
                player,
                form,
                // eslint-disable-next-line i18next/no-literal-string -- internal role tag
                "passer",
            );
            if (conflict !== null) {
                return renderHardRoleConflictBadge(conflict, t, elevation);
            }
            if (!help.active) return null;
            const evidence = help.evidenceByPlayer.get(player);
            if (evidence === undefined) return null;
            return renderPasserOptionBadge(evidence, t, elevation);
        },
        [form, help, t, elevationForPasser],
    );
    const renderRefuterBadge = useCallback(
        (player: Player): ReactNode => {
            const elevation = elevationForRefuter(player);
            const conflict = findHardRoleConflict(
                player,
                form,
                // eslint-disable-next-line i18next/no-literal-string -- internal role tag
                "refuter",
            );
            if (conflict !== null) {
                return renderHardRoleConflictBadge(conflict, t, elevation);
            }
            if (!help.active) return null;
            const evidence = help.evidenceByPlayer.get(player);
            if (evidence === undefined) return null;
            return renderRefuterOptionBadge(evidence, t, elevation);
        },
        [form, help, t, elevationForRefuter],
    );
    // Shown-card option badges render whenever we have advice for the
    // current refuter — self gets the full tier-bearing badge, other
    // refuters get the simpler N-cell warning. The Shown-card pill is
    // itself disabled until a refuter is set.
    const renderShownCardBadge = useCallback(
        (card: Card): ReactNode => {
            if (!help.active) return null;
            const badge = help.shownCardAdvice.get(card);
            return badge === undefined || badge === null
                ? null
                : renderShownCardBadgeNode(badge, t, elevationForShownCard(card));
        },
        [help, t, elevationForShownCard],
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
            // M3 closer step (desktop) anchors its popover to the
            // first suggestion input, which is the Suggester pill.
            tourAnchor: "suggest-first-pill",
            ...(errorReasonFor(PILL_SUGGESTER) !== undefined
                ? { errorReason: errorReasonFor(PILL_SUGGESTER) }
                : {}),
            content: (
                <SingleSelectList<Player>
                    options={playerOptions(setup)}
                    selected={form.suggester}
                    onCommit={commitSuggester}
                    nobodyLabel={null}
                    nobodyValue={null}
                    renderOptionBadge={renderSuggesterBadge}
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
            ...(warningReasonFor(PILL_PASSERS) !== undefined
                ? { warningReason: warningReasonFor(PILL_PASSERS) }
                : {}),
            ...(pillClearable?.passers === true && form.nonRefuters !== null
                ? { onClear: onClearPassers }
                : {}),
            content: (
                <MultiSelectList
                    options={playerOptions(setup)}
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
                    renderOptionBadge={renderPasserBadge}
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
            ...(warningReasonFor(PILL_REFUTER) !== undefined
                ? { warningReason: warningReasonFor(PILL_REFUTER) }
                : {}),
            ...(pillClearable?.refuter === true && form.refuter !== null
                ? { onClear: onClearRefuter }
                : {}),
            content: (
                <SingleSelectList<Player>
                    options={playerOptions(setup)}
                    selected={
                        isNobody(form.refuter) ? null : form.refuter
                    }
                    onCommit={commitRefuter}
                    nobodyLabel={t("popoverNobodyRefuted")}
                    nobodyValue={NOBODY}
                    renderOptionBadge={renderRefuterBadge}
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
            ...(warningReasonFor(PILL_SEEN) !== undefined
                ? { warningReason: warningReasonFor(PILL_SEEN) }
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
                    renderOptionBadge={renderShownCardBadge}
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
        warningReasonFor,
        isPillDisabled,
        onClearPassers,
        onClearRefuter,
        onClearSeenCard,
        pillClearable,
        renderSuggesterBadge,
        renderPasserBadge,
        renderRefuterBadge,
        renderShownCardBadge,
    ]);

    // --- Render --------------------------------------------------------
    const headerTitle = showHeader ? (
        <h3 className="mt-0 mb-0 text-[1.125rem] font-semibold">
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

    // Aggregate every soft warning into a single tooltip string for
    // the submit button. The button shows "Add anyway" + AlertIcon when
    // there's at least one warning and no hard error.
    const submitWarningReason = useMemo<string | undefined>(() => {
        if (warnings.size === 0) return undefined;
        const messages = Array.from(warnings.values()).map(warningMessageFor);
        return messages.join(" ");
    }, [warnings, warningMessageFor]);

    const submitWarningLabel = t(
        effectiveSubmitLabel === "update"
            ? "submitWithWarningUpdate"
            : "submitWithWarning",
    );

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
                { shortcut: shortcutSuffix("action.submit", hasKeyboard) },
            )}
            submitWarningLabel={submitWarningLabel}
            {...(submitWarningReason !== undefined
                ? { submitWarningReason }
                : {})}
            {...(submitBlockReason !== undefined ? { submitBlockReason } : {})}
            onSubmit={doSubmit}
            {...(onCancel !== undefined
                ? { onCancel, cancelLabel: t("cancelAction") }
                : {})}
            {...(headerTitle !== undefined ? { headerTitle } : {})}
            hasAnyInput={hasAnyInput}
            onClearInputs={onClearInputs}
            {...(showClearInputs
                ? { clearInputsLabel: t("clearInputs") }
                : {})}
            {...(keyboardScopeRef !== undefined ? { keyboardScopeRef } : {})}
        />
    );
});

// ---- Form state -------------------------------------------------------

/**
 * Form-internal shape — alias of the persistable
 * `PendingSuggestionDraft` so the form's local state can be lifted
 * directly into `ClueState` without a translation layer. Structurally
 * identical to a record of `Player | Card | Nobody | null` slots; the
 * UI-layer `Nobody` constant from `SuggestionPills` is a structural
 * match for the `{ kind: "nobody" }` shape declared in the logic
 * layer's `PendingSuggestionDraft`.
 */
export type FormState = PendingSuggestionDraft;

const emptyFormState = (setup: GameSetup): FormState => ({
    id: String(newSuggestionId()),
    suggester: null,
    cards: setup.categories.map(() => null),
    nonRefuters: null,
    refuter: null,
    seenCard: null,
});

/**
 * True when every value-bearing slot of the form is unfilled. Used to
 * decide whether to mirror the form back to the parent as a real
 * draft or as `null` (no draft in flight).
 */
const isEmptyFormState = (f: FormState): boolean =>
    f.suggester === null
    && f.cards.every(c => c === null)
    && f.nonRefuters === null
    && f.refuter === null
    && f.seenCard === null;

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
export const PILL_PASSERS: PillId = "passers";
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
 * pill to an error code. Cross-role conflicts mark BOTH offending
 * pills so the user sees the warning triangle on each side of the
 * conflict, matching the Shown-Card error treatment.
 *
 * Role-move helpers (`applySuggesterMove` etc.) intentionally do
 * NOT auto-clear other-role conflicts. Selecting Alice as both
 * Suggester and Refuter doesn't silently drop one role — both
 * pills surface as error pills until the user resolves the
 * paradox. This validator is the single source of truth for that
 * detection AND for the seenCard staleness check (a `seenCard`
 * whose corresponding category card was subsequently changed, or
 * a loaded draft whose saved shape happens to violate Clue rules).
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

    // Cross-role conflicts — mark BOTH sides of every conflict so the
    // user sees the warning on each pill, matching how Shown Card
    // flags its own problems.
    const passers: ReadonlyArray<Player> = Array.isArray(form.nonRefuters)
        ? form.nonRefuters
        : [];

    // First-rule-wins per pill: if a pill is already flagged by an
    // earlier check, leave its code alone so the three-way-collision
    // case stays interpretable (suggester == refuter == passer-of-self
    // reports "suggesterIsRefuter" on both endpoints and a passer-side
    // code on PASSERS).
    if (
        form.suggester !== null &&
        form.refuter !== null &&
        !isNobody(form.refuter) &&
        form.suggester === form.refuter
    ) {
        // eslint-disable-next-line i18next/no-literal-string -- internal error code
        errors.set(PILL_SUGGESTER, "suggesterIsRefuter");
        // eslint-disable-next-line i18next/no-literal-string -- internal error code
        errors.set(PILL_REFUTER, "suggesterIsRefuter");
    }
    if (
        form.suggester !== null &&
        passers.some(p => p === form.suggester)
    ) {
        if (!errors.has(PILL_SUGGESTER)) {
            // eslint-disable-next-line i18next/no-literal-string -- internal error code
            errors.set(PILL_SUGGESTER, "suggesterInPassers");
        }
        if (!errors.has(PILL_PASSERS)) {
            // eslint-disable-next-line i18next/no-literal-string -- internal error code
            errors.set(PILL_PASSERS, "suggesterInPassers");
        }
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
        if (!errors.has(PILL_PASSERS)) {
            // eslint-disable-next-line i18next/no-literal-string -- internal error code
            errors.set(PILL_PASSERS, "refuterInPassers");
        }
    }

    return errors;
};

/**
 * Soft-validation warning. Discriminated by `kind`; the payload names
 * the offending player(s) so the message can read naturally for self
 * ("You have...") and for other players ("Bob has...").
 *
 * Distinct from `PillErrorCode` because these are external-facts
 * contradictions (between the user's form choices and the deducer's
 * `Knowledge`), not internal inconsistencies. Submission stays enabled
 * when only soft warnings fire — the user can "Add anyway" if they
 * know something the solver has not been told.
 */
export type SoftWarning =
    | {
          readonly kind: "passersIncludePlayersWhoCanRefute";
          readonly players: ReadonlyArray<Player>;
      }
    | {
          readonly kind: "refuterCannotRefute";
          readonly player: Player;
      }
    | {
          readonly kind: "shownCardNotInRefuterHand";
          readonly player: Player;
      };

/**
 * Context passed to `validateFormSoft`. `selfPlayerId` no longer gates
 * the entire layer — every non-suggester player is checked against
 * `knowledge` — but it's still carried through so the help layer's
 * downstream consumers (badge tone, shown-card tier classification)
 * can branch on self vs other.
 */
export interface SoftValidationContext {
    readonly knowledge: Knowledge | undefined;
    readonly selfPlayerId: Player | null;
    readonly solverMode: SolverMode;
    readonly categoryCount: number;
}

/**
 * Check a form snapshot for soft-validation conflicts with deducer
 * Knowledge. Returns a map from pill to a warning. Empty map when the
 * help layer is suppressed (teach-me mode or no Knowledge).
 *
 * In Milestone 2 every non-suggester player is checked against
 * Knowledge, not just self — the engine `computeRefuteEvidence` is
 * already player-agnostic, so the validator just iterates the
 * selected passers / refuter and looks each up. Self gets the same
 * treatment as everyone else; the message layer picks a self-friendly
 * copy variant when the offender is self.
 *
 * Distinct from `validateFormConsistency` — that catches internal
 * paradoxes which BLOCK submission. These soft warnings let the user
 * proceed via "Add anyway" because external facts can be wrong (the
 * user may know something the solver has not been told yet).
 */
export const validateFormSoft = (
    form: FormState,
    ctx: SoftValidationContext,
): ReadonlyMap<PillId, SoftWarning> => {
    const warnings = new Map<PillId, SoftWarning>();
    if (ctx.solverMode === "check") return warnings;
    if (ctx.knowledge === undefined) return warnings;
    const knowledge = ctx.knowledge;

    const filledCards = form.cards.filter((c): c is Card => c !== null);
    const complete = filledCards.length === ctx.categoryCount;

    // Compute evidence per selected passer + the refuter — the only
    // players whose role contradicts something Knowledge could prove.
    const passers = Array.isArray(form.nonRefuters) ? form.nonRefuters : [];
    const passersWhoCanRefute: Array<Player> = [];
    for (const p of passers) {
        // Suggester-in-passers is a hard error already; skip soft.
        if (p === form.suggester) continue;
        const evidence = computeRefuteEvidence({
            knowledge,
            player: p,
            cards: filledCards,
            complete,
        });
        if (evidence === "definiteYes") passersWhoCanRefute.push(p);
    }
    if (passersWhoCanRefute.length > 0) {
        warnings.set(PILL_PASSERS, {
            kind: "passersIncludePlayersWhoCanRefute",
            players: passersWhoCanRefute,
        });
    }

    if (
        form.refuter !== null &&
        !isNobody(form.refuter) &&
        form.refuter !== form.suggester
    ) {
        const refuterEvidence = computeRefuteEvidence({
            knowledge,
            player: form.refuter,
            cards: filledCards,
            complete,
        });
        if (refuterEvidence === "definiteNo") {
            warnings.set(PILL_REFUTER, {
                kind: "refuterCannotRefute",
                player: form.refuter,
            });
        }
    }

    if (
        form.refuter !== null &&
        !isNobody(form.refuter) &&
        form.seenCard !== null &&
        !isNobody(form.seenCard) &&
        playerCellValue(knowledge, form.refuter, form.seenCard) === "N"
    ) {
        warnings.set(PILL_SEEN, {
            kind: "shownCardNotInRefuterHand",
            player: form.refuter,
        });
    }

    return warnings;
};

/**
 * Per-card badge to render in the Shown-card dropdown when self is
 * refuter. `tier` is the leak-tier classification from
 * `classifyRefuteCandidates`; `forced` is true when self has exactly
 * one suggestion card to show; `recommended` is true when this card
 * ties for the best tier among multiple Y candidates.
 */
interface ShownCardCandidateBadge {
    readonly kind: "candidate";
    readonly tier: RefuteAdviceTier;
    readonly forced: boolean;
    readonly recommended: boolean;
}

/**
 * Badge state for the Shown-card option dropdown. `"doNotHave"` for a
 * card we have a `"N"` cell on; `"candidate"` for a known-`"Y"` card
 * with its refute-advice classification; `null` for `undefined`
 * cells (no information either way — render nothing).
 */
export type ShownCardBadge =
    | ShownCardCandidateBadge
    | { readonly kind: "doNotHave" }
    | null;

/**
 * Help context returned by `useRefuteHelp`. `evidenceByPlayer` carries
 * the relationship between every non-suggester player and the current
 * filled-card suggestion — drives the Passers / Refuter row badges.
 * `shownCardAdvice` is the per-card badge map for the Shown-card
 * dropdown, indexed by whichever player the user has named as refuter.
 *
 * `active === false` means the help layer is suppressed entirely (no
 * provider, teach-me mode, or no Knowledge available). Callers still
 * get a stable shape so call sites don't need null-checks everywhere.
 * `selfPlayerId` is still surfaced so the message layer can branch to
 * a self-friendly copy variant when the offender is self.
 */
export interface RefuteHelp {
    readonly active: boolean;
    readonly selfPlayerId: Player | null;
    readonly evidenceByPlayer: ReadonlyMap<Player, RefuteEvidence>;
    readonly shownCardAdvice: ReadonlyMap<Card, ShownCardBadge>;
}

const INACTIVE_HELP: RefuteHelp = {
    active: false,
    selfPlayerId: null,
    evidenceByPlayer: new Map(),
    shownCardAdvice: new Map(),
};

/**
 * Build the per-card badge map for the Shown-card dropdown. Drives the
 * `[!] Do not have` warning on N-cells, plus tier + Forced/Recommended
 * decorations on Y-cells (suggestion cards self holds). Pure helper —
 * exported for testing.
 */
export const computeShownCardAdvice = (args: {
    readonly knowledge: Knowledge;
    readonly selfPlayer: Player;
    readonly pendingSuggester: Player;
    readonly suggestionCards: ReadonlyArray<Card>;
    readonly suggestions: ReadonlyArray<DraftSuggestion>;
    readonly suggesterPerspective:
        | Parameters<typeof classifyRefuteCandidates>[0]["suggesterPerspective"];
}): ReadonlyMap<Card, ShownCardBadge> => {
    const {
        knowledge,
        selfPlayer,
        pendingSuggester,
        suggestionCards,
        suggestions,
        suggesterPerspective,
    } = args;
    const out = new Map<Card, ShownCardBadge>();
    if (suggestionCards.length === 0) return out;
    // Classify N / Y / undefined per suggestion card. Knowledge is the
    // single source of truth — a "Y" cell from a deduction counts the
    // same as a directly-entered known card.
    const yCards: Array<Card> = [];
    const perCardCell = new Map<Card, "Y" | "N" | undefined>();
    for (const card of suggestionCards) {
        const cell = playerCellValue(knowledge, selfPlayer, card);
        perCardCell.set(card, cell);
        if (cell === "Y") yCards.push(card);
    }
    // Run the existing tier classifier across self's Y-cells only.
    // `classifyRefuteCandidates` already marks the best-tier
    // candidate(s) as `recommended`. We layer "forced" on top: when
    // exactly one Y exists, that single card is the only thing self
    // can show — no "recommended among equals", just "this is your
    // only choice".
    const candidates =
        yCards.length > 0
            ? classifyRefuteCandidates({
                  selfPlayer,
                  pendingSuggester,
                  handCandidates: yCards,
                  suggestions,
                  suggesterPerspective,
              })
            : [];
    // Are all candidates the same tier? If so, "recommended among
    // equals" is meaningless — suppress the Recommended badge per the
    // M1 spec (the user has multiple options at the same leak level).
    const distinctTiers = new Set(candidates.map(c => c.tier));
    const allSameTier = distinctTiers.size === 1;
    const forced = yCards.length === 1;
    const candidateByCard = new Map<Card, RefuteAdviceCandidate>();
    for (const c of candidates) candidateByCard.set(c.card, c);
    for (const card of suggestionCards) {
        const cell = perCardCell.get(card);
        if (cell === "Y") {
            const c = candidateByCard.get(card);
            if (c === undefined) continue;
            out.set(card, {
                kind: "candidate",
                tier: c.tier,
                forced,
                // Forced cards don't render a Recommended badge —
                // "Forced" already carries the "best choice" meaning
                // alongside the tier label.
                recommended: !forced && !allSameTier && c.recommended,
            });
        } else if (cell === "N") {
            out.set(card, { kind: "doNotHave" });
        }
        // undefined → no entry, callers render no badge.
    }
    return out;
};

/**
 * Hook: derive the multi-player help context from the current form
 * state + canonical Knowledge. Returns `INACTIVE_HELP` when the help
 * layer is suppressed (no `<ClueProvider>`, teach-me mode, or no
 * Knowledge).
 *
 * The shape is stable across call sites so consumers (Passers /
 * Refuter / Shown card dropdowns + soft-validation pill warnings)
 * never need to null-check on every render — they branch on `active`
 * and otherwise treat the fields as authoritative.
 *
 * Multi-player vs Milestone 1: the engine `computeRefuteEvidence` is
 * applied to every non-suggester player to build `evidenceByPlayer`.
 * Shown-card advice keys off the user's chosen `refuter` rather than
 * self — self as refuter still gets the full leak-tier classifier,
 * other refuters get a simpler N-cell "Do not have" warning.
 */
const useRefuteHelp = (form: FormState): RefuteHelp => {
    const ctx = useClueOptional();
    return useMemo<RefuteHelp>(() => {
        if (ctx === undefined) return INACTIVE_HELP;
        const { state, derived } = ctx;
        if (state.solverMode === "check") return INACTIVE_HELP;
        if (!Result.isSuccess(derived.deductionResult)) return INACTIVE_HELP;
        const knowledge = derived.deductionResult.success;
        const selfPlayer = state.selfPlayerId;
        const filledCards = form.cards.filter(
            (c): c is Card => c !== null,
        );
        const complete =
            filledCards.length === state.setup.cardSet.categories.length;

        // Per-player evidence map. Skip the suggester — they can't
        // refute their own suggestion, so badges on the suggester row
        // would be confusing. The suggester-in-passers / -refuter
        // case is already a hard error elsewhere.
        const evidenceByPlayer = new Map<Player, RefuteEvidence>();
        for (const p of state.setup.players) {
            if (p === form.suggester) continue;
            evidenceByPlayer.set(
                p,
                computeRefuteEvidence({
                    knowledge,
                    player: p,
                    cards: filledCards,
                    complete,
                }),
            );
        }

        // Shown-card advice: keyed off whichever player the user has
        // named as refuter. Self gets the full leak-tier classifier;
        // any other refuter gets the simpler N-cell warning so we
        // still flag "Bob can't have shown the Knife".
        let shownCardAdvice: ReadonlyMap<Card, ShownCardBadge>;
        if (
            form.refuter !== null
            && !isNobody(form.refuter)
            && form.refuter === selfPlayer
            && form.suggester !== null
            && filledCards.length > 0
        ) {
            const perspectiveResult = derived.perspectives.get(form.suggester);
            const perspective =
                perspectiveResult !== undefined &&
                Result.isSuccess(perspectiveResult)
                    ? perspectiveResult.success
                    : undefined;
            shownCardAdvice = computeShownCardAdvice({
                knowledge,
                selfPlayer,
                pendingSuggester: form.suggester,
                suggestionCards: filledCards,
                suggestions: state.suggestions,
                suggesterPerspective: perspective,
            });
        } else if (
            form.refuter !== null
            && !isNobody(form.refuter)
            && filledCards.length > 0
        ) {
            // Non-self refuter — just flag N-cells. Y-cells get no
            // badge: the user has confidently said "this player has
            // this card", and confirming via a muted "Has" pill is
            // visual noise rather than help.
            const refuterId = form.refuter;
            const map = new Map<Card, ShownCardBadge>();
            for (const card of filledCards) {
                if (playerCellValue(knowledge, refuterId, card) === "N") {
                    map.set(card, { kind: "doNotHave" });
                }
            }
            shownCardAdvice = map;
        } else {
            // No refuter resolved — the Shown-card pill is disabled
            // anyway, so an empty map is fine.
            shownCardAdvice = new Map();
        }
        return {
            active: true,
            selfPlayerId: selfPlayer,
            evidenceByPlayer,
            shownCardAdvice,
        };
    }, [ctx, form]);
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
 * Every player in the setup, as a candidate option. The suggester /
 * passers / refuter pills all show the same full list — they used
 * to filter to "not in another role" but that created a sequencing
 * trap (selecting Alice as refuter then trying to make her a passer
 * required clearing refuter first). Now selection moves the player
 * between roles automatically; see `applyRoleMove*` below.
 */
const playerOptions = (
    setup: GameSetup,
): ReadonlyArray<Option<Player>> =>
    setup.players.map(p => ({ value: p, label: String(p) }));

// ---- Role-move helpers ----------------------------------------------

/**
 * Apply a player to the suggester slot. Other-role conflicts (player
 * already in passers / refuter) are NOT silently resolved here —
 * `validateFormConsistency` surfaces the conflict as a dual-pill
 * error so the user can decide which role to keep. Pure; exported
 * for testing.
 */
export const applySuggesterMove = (
    form: FormState,
    player: Player,
): FormState => ({ ...form, suggester: player });

/**
 * Apply a passers value. NOBODY and null pass through unchanged (no
 * players to compare). Other-role conflicts are flagged by
 * `validateFormConsistency` rather than auto-cleared. Pure;
 * exported for testing.
 */
export const applyPassersMove = (
    form: FormState,
    value: ReadonlyArray<Player> | Nobody | null,
): FormState => ({ ...form, nonRefuters: value });

/**
 * Apply a refuter value. NOBODY clears any stale shown card — that's
 * a structural invariant ("no refuter means no shown card"), not
 * conflict resolution. Other-role conflicts are flagged by
 * `validateFormConsistency`. Pure; exported for testing.
 */
export const applyRefuterMove = (
    form: FormState,
    value: Player | Nobody,
): FormState => {
    if (isNobody(value)) {
        return { ...form, refuter: value, seenCard: null };
    }
    return { ...form, refuter: value };
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

// ---- Help-layer badge node builders ----------------------------------
//
// Per-player badge rules:
//   - Passers row: warning "Can refute" on definiteYes (contradicts
//     listing the player as passing), muted "Cannot refute" on
//     definiteNo (consistent with the choice), nothing otherwise.
//   - Refuter row: muted "Can refute" on definiteYes (consistent),
//     warning "Cannot refute" on definiteNo (contradicts choosing
//     them as refuter), nothing otherwise.
//
// Same engine, inverted tone per role: the warning fires for the
// choice that contradicts what Knowledge says about the player.
// Applied uniformly to self and other players — the user is equally
// likely to mis-log either, and the engine has no reason to weight
// "I'm sure about self" higher than "the deducer is sure about Bob".

type TFnAny = ReturnType<typeof useTranslations<string>>;

const BADGE_WARNING_CLASS =
    "ml-2 inline-flex items-center gap-1 rounded-[var(--radius)] " +
    "border border-warning-border bg-warning-bg px-1.5 py-0.5 " +
    "text-[0.85em] text-warning";

const BADGE_ERROR_CLASS =
    "ml-2 inline-flex items-center gap-1 rounded-[var(--radius)] " +
    "border border-danger-border bg-danger-bg px-1.5 py-0.5 " +
    "text-[0.85em] text-danger";

// Muted needs a visible background on `bg-panel` popovers — `bg-control`
// reads as a deliberate, slight lift on the cream popover surface, and
// the aged-paper border parallels the warning / error badge shape.
const BADGE_MUTED_CLASS =
    "ml-2 inline-flex items-center rounded-[var(--radius)] " +
    "border border-border bg-control px-1.5 py-0.5 " +
    "text-[0.85em] text-muted";

/**
 * Visual elevation for an option-row badge. Dropdown option badges
 * stay informational (`muted`) until the pill itself surfaces an error
 * or warning whose CAUSE is this specific option — then the badge
 * elevates to match the pill's tone. The text label is identical
 * across all three elevations; only the chip style + presence of
 * `AlertIcon` changes.
 */
type BadgeElevation = "error" | "warning" | "muted";

/**
 * The role a player currently occupies in `form`. Used by
 * `findHardRoleConflict` to label dropdown options that would create
 * a cross-role hard error if selected (e.g. picking the current
 * Refuter as the Suggester triggers `suggesterIsRefuter`).
 */
export type FormPlayerRole = "suggester" | "refuter" | "passer";

/**
 * The dropdown the option lives in. The option's "own" role is never
 * reported back — selecting the current refuter inside the Refuter
 * dropdown is a re-selection, not a conflict.
 */
export type DropdownRole = FormPlayerRole;

/**
 * If `player` already occupies one of the OTHER cross-role slots in
 * `form`, return which one. Otherwise null. Pure; exported for tests.
 *
 * The three rules this previews are the cross-role hard conflicts
 * from `validateFormConsistency`: `suggesterIsRefuter`,
 * `suggesterInPassers`, and `refuterInPassers`. Per `AGENTS.md`'s
 * vocabulary rule we surface only the OFFENDING role on the badge —
 * what the badge tells the user is "this player already plays role X
 * elsewhere on this form".
 */
/* eslint-disable i18next/no-literal-string -- role tags are internal enum values, not user-facing copy */
export const findHardRoleConflict = (
    player: Player,
    form: FormState,
    dropdown: DropdownRole,
): FormPlayerRole | null => {
    if (dropdown !== "suggester" && form.suggester === player) {
        return "suggester";
    }
    if (
        dropdown !== "refuter" &&
        form.refuter !== null &&
        !isNobody(form.refuter) &&
        form.refuter === player
    ) {
        return "refuter";
    }
    if (
        dropdown !== "passer" &&
        Array.isArray(form.nonRefuters) &&
        form.nonRefuters.some(p => p === player)
    ) {
        return "passer";
    }
    return null;
};
/* eslint-enable i18next/no-literal-string */

const HARD_CONFLICT_BADGE_KEY: Record<FormPlayerRole, string> = {
    suggester: "pillBadgeRoleSuggester",
    refuter: "pillBadgeRoleRefuter",
    passer: "pillBadgeRolePasser",
};

const renderElevatedBadge = (
    elevation: BadgeElevation,
    label: string,
): ReactNode => {
    if (elevation === "muted") {
        return <span className={BADGE_MUTED_CLASS}>{label}</span>;
    }
    return (
        <span
            className={
                elevation === "error"
                    ? BADGE_ERROR_CLASS
                    : BADGE_WARNING_CLASS
            }
            role="status"
        >
            <AlertIcon className="h-[0.95em] w-[0.95em]" />
            {label}
        </span>
    );
};

const renderHardRoleConflictBadge = (
    role: FormPlayerRole,
    t: TFnAny,
    elevation: BadgeElevation,
): ReactNode => renderElevatedBadge(elevation, t(HARD_CONFLICT_BADGE_KEY[role]));

// Tier label key map — mirrors the one in RefuteAdvicePanel so the
// dropdown badges read in the same vocabulary as the advice panel.
const TIER_LABEL_KEY: Record<RefuteAdviceTier, string> = {
    alreadyShownToSuggester: "tierAlreadyShownToSuggesterLabel",
    suggesterCanDeduce: "tierSuggesterCanDeduceLabel",
    alreadyShownToOther: "tierAlreadyShownToOtherLabel",
    freshLeak: "tierFreshLeakLabel",
};

const renderPasserOptionBadge = (
    evidence: RefuteEvidence,
    t: TFnAny,
    elevation: BadgeElevation,
): ReactNode => {
    if (evidence === "definiteYes") {
        return renderElevatedBadge(elevation, t("pillBadgeCanRefute"));
    }
    if (evidence === "definiteNo") {
        return renderElevatedBadge(elevation, t("pillBadgeCannotRefute"));
    }
    return null;
};

const renderRefuterOptionBadge = (
    evidence: RefuteEvidence,
    t: TFnAny,
    elevation: BadgeElevation,
): ReactNode => {
    if (evidence === "definiteYes") {
        return renderElevatedBadge(elevation, t("pillBadgeCanRefute"));
    }
    if (evidence === "definiteNo") {
        return renderElevatedBadge(elevation, t("pillBadgeCannotRefute"));
    }
    return null;
};

const renderShownCardBadgeNode = (
    badge: ShownCardBadge,
    t: TFnAny,
    elevation: BadgeElevation,
): ReactNode => {
    if (badge === null) return null;
    if (badge.kind === "doNotHave") {
        return renderElevatedBadge(elevation, t("pillBadgeDoNotHave"));
    }
    // Candidate: tier label + optional Forced / Recommended. These chips
    // stay muted regardless of pill state — they're advice, not warnings.
    return (
        <span className="ml-2 inline-flex items-center gap-1">
            <span className={BADGE_MUTED_CLASS}>
                {t(TIER_LABEL_KEY[badge.tier])}
            </span>
            {badge.forced && (
                <span className={BADGE_MUTED_CLASS}>{t("pillBadgeForced")}</span>
            )}
            {badge.recommended && (
                <span className={BADGE_MUTED_CLASS}>
                    {t("pillBadgeRecommended")}
                </span>
            )}
        </span>
    );
};

