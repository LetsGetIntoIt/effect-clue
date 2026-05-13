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
import { AccusationId, newAccusationId } from "../../logic/Accusation";
import type { DraftAccusation } from "../../logic/ClueState";
import type { Card, Player } from "../../logic/GameObjects";
import type { GameSetup } from "../../logic/GameSetup";
import { categoryOfCard } from "../../logic/GameSetup";
import { useHasKeyboard } from "../hooks/useHasKeyboard";
import { shortcutSuffix } from "../keyMap";
import {
    nextEnabledPill,
    type OpenTarget,
    PillForm,
    type PillFormHandle,
    type PillSlot,
} from "./PillForm";
import {
    displayCard,
    displayPlayer,
    isNobody,
    type Nobody,
    type Option,
    pillStatusForCard,
    pillStatusForPlayer,
    SingleSelectList,
} from "./SuggestionPills";

/**
 * Imperative handle exposed via `ref` so callers can drive focus
 * without baking global keyboard bindings into the form. Mirrors
 * `SuggestionFormHandle`. Exported so the `AddSuggestion` host in
 * `SuggestionLogPanel` can hold an `AccusationFormHandle`-typed ref
 * for the ⌘I shortcut wiring.
 */
export interface AccusationFormHandle {
    readonly focusFirstPill: (options?: { readonly clear?: boolean }) => void;
    /**
     * Reset every pill to empty. Used by the section-header X button
     * (in `AddSuggestion`) to clear the form without re-mounting it.
     */
    readonly clearInputs: () => void;
}

interface AccusationFormProps {
    readonly setup: GameSetup;
    /** Pre-populate from an existing accusation; switches to "update" submit. */
    readonly accusation?: DraftAccusation;
    readonly onSubmit: (draft: DraftAccusation) => void;
    readonly onCancel?: () => void;
    /** Hide the h3 title (used inline within an existing row). */
    readonly showHeader?: boolean;
    /** Override the submit-button label. Defaults from `accusation` presence. */
    readonly submitLabel?: "add" | "update";
    /**
     * Optional outer element whose focus also counts as "in the form"
     * for Cmd+Enter. The inline-edit row passes its `<li>` ref here so
     * Cmd+Enter from anywhere in the row commits the draft.
     */
    readonly keyboardScopeRef?: React.RefObject<HTMLElement | null>;
    /**
     * Notify the parent whenever the form transitions between empty
     * and "has at least one filled slot." Drives the section-header
     * "Add a suggestion / accusation" copy + clear-inputs X button.
     */
    readonly onHasAnyInputChange?: (hasAnyInput: boolean) => void;
}

/**
 * Pill-driven form for composing (or editing) a failed accusation.
 *
 * Shape: one accuser pill, one card pill per category. Pill rendering,
 * popover open/close, keyboard nav (Tab + Arrow + Cmd+Enter), and
 * submit/cancel button styling all come from the shared
 * `<PillForm>`. AccusationForm owns the form state + commit logic +
 * auto-advance, but doesn't reimplement any of the keyboard /
 * focus / styling concerns.
 *
 * Submit contract:
 *   - All pills (accuser + one per category) must be filled to enable
 *     the Add button. The button gets focus the moment that's true so
 *     a single Enter keystroke submits.
 *   - `Cmd+Enter` / `Ctrl+Enter` submits from anywhere inside the
 *     form (including open popovers).
 */
export const AccusationForm = forwardRef<
    AccusationFormHandle,
    AccusationFormProps
>(function AccusationForm(
    {
        setup,
        accusation,
        onSubmit,
        onCancel,
        showHeader = true,
        submitLabel,
        keyboardScopeRef,
        onHasAnyInputChange,
    },
    ref,
): React.ReactElement {
    const effectiveSubmitLabel: "add" | "update" =
        // eslint-disable-next-line i18next/no-literal-string -- internal mode discriminator
        submitLabel ?? (accusation !== undefined ? "update" : "add");
    const t = useTranslations("accusations");
    const hasKeyboard = useHasKeyboard();

    const [form, setForm] = useState<FormState>(() =>
        accusation !== undefined
            ? formStateFromDraft(accusation, setup)
            : emptyFormState(setup),
    );

    // Re-seed when the accusation prop changes (covers the "edit a
    // different row" case without remounting).
    const seededIdRef = useRef<string | undefined>(accusation?.id);
    useEffect(() => {
        if (accusation?.id === seededIdRef.current) return;
        seededIdRef.current = accusation?.id;
        setForm(
            accusation !== undefined
                ? formStateFromDraft(accusation, setup)
                : emptyFormState(setup),
        );
    }, [accusation, setup]);

    const [openPillId, setOpenPillId] = useState<OpenTarget>(null);
    const pillFormRef = useRef<PillFormHandle>(null);

    const pillSequence: ReadonlyArray<string> = useMemo(
        () => [
            PILL_ACCUSER,
            ...setup.categories.map((_, i) => cardPillId(i)),
        ],
        [setup],
    );

    const commitAndAdvance = useCallback(
        (next: FormState, fromId: string) => {
            setForm(next);
            // No disabled pills in this form, so the "skip disabled"
            // wrinkle of nextEnabledPill is a no-op here.
            setOpenPillId(nextEnabledPill(pillSequence, fromId, () => false));
        },
        [pillSequence],
    );

    const onClearInputs = useCallback(() => {
        setForm(emptyFormState(setup));
        setOpenPillId(null);
    }, [setup]);

    useImperativeHandle(
        ref,
        () => ({
            focusFirstPill({ clear } = {}) {
                if (clear) setForm(emptyFormState(setup));
                pillFormRef.current?.focusFirstPill();
            },
            clearInputs: onClearInputs,
        }),
        [setup, onClearInputs],
    );

    const draft = useMemo(() => buildDraftFromForm(form), [form]);
    const canSubmit = draft !== null;

    // Mirror has-any-input to the parent. Held behind a ref so the
    // effect doesn't re-fire when the callback's identity changes.
    const hasAnyInput =
        form.accuser !== null || form.cards.some(c => c !== null);
    const onHasAnyInputChangeRef = useRef(onHasAnyInputChange);
    useEffect(() => {
        onHasAnyInputChangeRef.current = onHasAnyInputChange;
    });
    useEffect(() => {
        onHasAnyInputChangeRef.current?.(hasAnyInput);
    }, [hasAnyInput]);

    const onSubmitClick = useCallback(() => {
        if (draft === null) return;
        // Edit-mode preserves the original `loggedAt` so re-saving
        // doesn't re-order the entry in the prior log; add-mode mints
        // `Date.now()` so the new entry lands at the bottom (most recent).
        const submittable: DraftAccusation = {
            ...draft,
            loggedAt: accusation?.loggedAt ?? Date.now(),
        };
        onSubmit(submittable);
        if (accusation === undefined) {
            setForm(emptyFormState(setup));
            setOpenPillId(null);
        }
    }, [draft, onSubmit, accusation, setup]);

    const playerOptions: ReadonlyArray<Option<Player>> = useMemo(
        () => setup.players.map(p => ({ value: p, label: String(p) })),
        [setup.players],
    );

    const slots: ReadonlyArray<PillSlot> = useMemo(() => {
        const accuserSlot: PillSlot = {
            id: PILL_ACCUSER,
            label: t("pillAccuser"),
            status: pillStatusForPlayer(form.accuser, false),
            valueDisplay: displayPlayer(form.accuser),
            content: (
                <SingleSelectList<Player>
                    options={playerOptions}
                    selected={form.accuser}
                    onCommit={(value: Player | Nobody) => {
                        if (isNobody(value)) return;
                        commitAndAdvance(
                            { ...form, accuser: value },
                            PILL_ACCUSER,
                        );
                    }}
                    nobodyLabel={null}
                    nobodyValue={null}
                />
            ),
        };
        const cardSlots: ReadonlyArray<PillSlot> = setup.categories.map(
            (category, i) => {
                const id = cardPillId(i);
                const cardOptions: ReadonlyArray<Option<Card>> =
                    category.cards.map(entry => ({
                        value: entry.id,
                        label: entry.name,
                    }));
                const selectedCard = form.cards[i] ?? null;
                return {
                    id,
                    label: category.name,
                    status: pillStatusForCard(selectedCard, false),
                    valueDisplay: displayCard(selectedCard, setup),
                    content: (
                        <SingleSelectList<Card>
                            options={cardOptions}
                            selected={selectedCard}
                            onCommit={(value: Card | Nobody) => {
                                if (isNobody(value)) return;
                                const nextCards = form.cards.slice();
                                nextCards[i] = value;
                                commitAndAdvance(
                                    { ...form, cards: nextCards },
                                    id,
                                );
                            }}
                            nobodyLabel={null}
                            nobodyValue={null}
                        />
                    ),
                };
            },
        );
        return [accuserSlot, ...cardSlots];
    }, [form, playerOptions, setup, t, commitAndAdvance]);

    const headerTitle = showHeader ? (
        <h3 className="mt-0 mb-0 text-[1.125rem] font-semibold">
            {effectiveSubmitLabel === "update"
                ? t("editTitle")
                : t("addTitle")}
        </h3>
    ) : undefined;

    return (
        <PillForm
            ref={pillFormRef}
            slots={slots}
            pillSequence={pillSequence}
            openPillId={openPillId}
            onOpenPillIdChange={setOpenPillId}
            canSubmit={canSubmit}
            submitLabel={t(
                effectiveSubmitLabel === "update" ? "updateAction" : "submit",
                { shortcut: shortcutSuffix("action.submit", hasKeyboard) },
            )}
            onSubmit={onSubmitClick}
            {...(onCancel !== undefined
                ? { onCancel, cancelLabel: t("cancelAction") }
                : {})}
            {...(headerTitle !== undefined ? { headerTitle } : {})}
            hasAnyInput={hasAnyInput}
            onClearInputs={onClearInputs}
            {...(keyboardScopeRef !== undefined ? { keyboardScopeRef } : {})}
        />
    );
});

// ---- Pill IDs ----------------------------------------------------------
//
// Module-level `as const` so callers compare against typed sentinels
// instead of inline string literals — and the lint rule's
// type-narrowing exemption covers them. Mirrors the
// `PILL_SUGGESTER` / `TARGET_SUBMIT` pattern from `SuggestionForm.tsx`.

const PILL_ACCUSER = "accuser" as const;
const cardPillId = (i: number): string => `card-${i}`;


// ---- Form state ---------------------------------------------------------

interface FormState {
    readonly id: AccusationId;
    readonly accuser: Player | null;
    readonly cards: ReadonlyArray<Card | null>;
}

const emptyFormState = (setup: GameSetup): FormState => ({
    id: AccusationId(""),
    accuser: null,
    cards: setup.categories.map(() => null),
});

const formStateFromDraft = (
    draft: DraftAccusation,
    setup: GameSetup,
): FormState => ({
    id: draft.id,
    accuser: draft.accuser,
    cards: setup.categories.map(c =>
        draft.cards.find(card => categoryOfCard(setup, card) === c.id) ??
        null,
    ),
});

const buildDraftFromForm = (form: FormState): DraftAccusation | null => {
    if (form.accuser === null) return null;
    const cards: Card[] = [];
    for (const c of form.cards) {
        if (c === null) return null;
        cards.push(c);
    }
    return {
        id: form.id === AccusationId("") ? newAccusationId() : form.id,
        accuser: form.accuser,
        cards,
    };
};
