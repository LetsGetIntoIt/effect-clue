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
import { matches } from "../keyMap";
import {
    displayCard,
    displayPlayer,
    isInsideSuggestionPopover,
    isNobody,
    type Nobody,
    type Option,
    PillPopover,
    pillStatusForCard,
    pillStatusForPlayer,
    SingleSelectList,
} from "./SuggestionPills";

/**
 * Imperative handle exposed via `ref` so callers can drive focus
 * without baking global keyboard bindings into the form. Mirrors
 * `SuggestionFormHandle`. Not exported by name today — callers that
 * need the handle reach for it through the forwardRef return type.
 */
interface AccusationFormHandle {
    readonly focusFirstPill: (options?: { readonly clear?: boolean }) => void;
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
}

/**
 * Pill-driven form for composing (or editing) a failed accusation.
 *
 * Shape: one accuser pill, one card pill per category. Clicking a pill
 * opens a popover with the candidate list; selecting a value
 * auto-advances to the next pill, terminating on the submit button.
 *
 * Smaller surface area than `SuggestionForm` — no optional refuter /
 * passers / shown card, no Nobody states, no cross-pill validation —
 * so the implementation is intentionally compact while sharing the
 * same `PillPopover` + `SingleSelectList` primitives so the visual
 * language stays consistent.
 *
 * Submit contract:
 *   - All pills (accuser + one per category) must be filled to enable
 *     the Add button. The button gets `autoFocus` at that moment so
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
    },
    ref,
): React.ReactElement {
    const effectiveSubmitLabel: "add" | "update" =
        // eslint-disable-next-line i18next/no-literal-string -- internal mode discriminator
        submitLabel ?? (accusation !== undefined ? "update" : "add");
    const t = useTranslations("accusations");

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
    const submitBtnRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (openPillId === TARGET_SUBMIT) submitBtnRef.current?.focus();
    }, [openPillId]);

    const pillSequence: ReadonlyArray<PillId> = useMemo(
        () => [PILL_ACCUSER, ...setup.categories.map((_, i) => cardPillId(i))],
        [setup],
    );

    const nextPillId = useCallback(
        (from: PillId): OpenTarget => {
            const idx = pillSequence.indexOf(from);
            if (idx < 0 || idx === pillSequence.length - 1) return TARGET_SUBMIT;
            return pillSequence[idx + 1] ?? TARGET_SUBMIT;
        },
        [pillSequence],
    );

    const commitAndAdvance = useCallback(
        (next: FormState, from: PillId) => {
            setForm(next);
            setOpenPillId(nextPillId(from));
        },
        [nextPillId],
    );

    const onOpenChangeFor = useCallback(
        (id: PillId) => (open: boolean) => {
            setOpenPillId(prev =>
                open ? id : prev === id ? null : prev,
            );
        },
        [],
    );

    const formRef = useRef<HTMLFormElement>(null);

    useImperativeHandle(
        ref,
        () => ({
            focusFirstPill({ clear } = {}) {
                if (clear) setForm(emptyFormState(setup));
                setOpenPillId(PILL_ACCUSER);
            },
        }),
        [setup],
    );

    // Cmd+Enter / Ctrl+Enter submits when a focusable element inside
    // this form (or the optional outer scope) holds focus. Scoping to
    // the form prevents global submits from firing anywhere else on
    // the page.
    const draft = useMemo(() => buildDraftFromForm(form), [form]);
    const canSubmit = draft !== null;
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!matches("action.commit", e)) return;
            const active = document.activeElement;
            const inForm =
                active instanceof Element &&
                (formRef.current?.contains(active) ||
                    isInsideSuggestionPopover(active) ||
                    keyboardScopeRef?.current?.contains(active));
            if (!inForm) return;
            if (canSubmit && draft !== null) {
                e.preventDefault();
                onSubmit(draft);
                if (accusation === undefined) {
                    setForm(emptyFormState(setup));
                    setOpenPillId(null);
                }
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [canSubmit, draft, onSubmit, accusation, setup, keyboardScopeRef]);

    const onSubmitClick = () => {
        if (draft === null) return;
        onSubmit(draft);
        if (accusation === undefined) {
            setForm(emptyFormState(setup));
            setOpenPillId(null);
        }
    };

    const playerOptions: ReadonlyArray<Option<Player>> = useMemo(
        () =>
            setup.players.map(p => ({ value: p, label: String(p) })),
        [setup.players],
    );

    return (
        <form
            ref={formRef}
            onSubmit={e => {
                e.preventDefault();
                onSubmitClick();
            }}
            className="text-[13px]"
        >
            {showHeader && (
                <h3 className="mt-0 mb-2 text-[14px] font-semibold">
                    {effectiveSubmitLabel === "update"
                        ? t("editTitle")
                        : t("addTitle")}
                </h3>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
                <PillPopover
                    pillId={PILL_ACCUSER}
                    label={t("pillAccuser")}
                    status={pillStatusForPlayer(form.accuser, true)}
                    valueDisplay={displayPlayer(form.accuser)}
                    open={openPillId === PILL_ACCUSER}
                    onOpenChange={onOpenChangeFor(PILL_ACCUSER)}
                >
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
                </PillPopover>
                {setup.categories.map((category, i) => {
                    const pillId: PillId = cardPillId(i);
                    const cardOptions: ReadonlyArray<Option<Card>> =
                        category.cards.map(entry => ({
                            value: entry.id,
                            label: entry.name,
                        }));
                    const selectedCard = form.cards[i] ?? null;
                    return (
                        <PillPopover
                            key={String(category.id)}
                            pillId={pillId}
                            label={category.name}
                            status={pillStatusForCard(selectedCard, true)}
                            valueDisplay={displayCard(selectedCard, setup)}
                            open={openPillId === pillId}
                            onOpenChange={onOpenChangeFor(pillId)}
                        >
                            <SingleSelectList<Card>
                                options={cardOptions}
                                selected={selectedCard}
                                onCommit={(value: Card | Nobody) => {
                                    if (isNobody(value)) return;
                                    const nextCards = form.cards.slice();
                                    nextCards[i] = value;
                                    commitAndAdvance(
                                        { ...form, cards: nextCards },
                                        pillId,
                                    );
                                }}
                                nobodyLabel={null}
                                nobodyValue={null}
                            />
                        </PillPopover>
                    );
                })}
            </div>
            <div className="mt-3 flex items-center gap-2">
                <button
                    ref={submitBtnRef}
                    type="submit"
                    disabled={!canSubmit}
                    className={
                        "rounded border px-3 py-1.5 text-[13px] " +
                        (canSubmit
                            ? "cursor-pointer border-accent bg-accent text-white hover:opacity-90"
                            : "cursor-not-allowed border-border bg-transparent text-muted")
                    }
                    autoFocus={canSubmit && openPillId === TARGET_SUBMIT}
                >
                    {effectiveSubmitLabel === "update"
                        ? t("updateAction")
                        : t("submit")}
                </button>
                {onCancel !== undefined && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="cursor-pointer rounded border border-border bg-transparent px-3 py-1.5 text-[13px] text-muted hover:text-accent"
                    >
                        {t("cancelAction")}
                    </button>
                )}
            </div>
        </form>
    );
});

// ---- Pill IDs ----------------------------------------------------------
//
// String tags identifying which pill is currently open. Module-level
// `as const` declarations so callers compare against typed sentinels
// instead of inline string literals — and the lint rule's
// type-narrowing exemption covers them. Mirrors the
// `PILL_SUGGESTER` / `TARGET_SUBMIT` pattern from `SuggestionForm.tsx`.

const PILL_ACCUSER = "accuser" as const;
const TARGET_SUBMIT = "submit" as const;
const cardPillId = (i: number): PillId => `card-${i}` as PillId;

type PillId = typeof PILL_ACCUSER | `card-${number}`;
type OpenTarget = PillId | typeof TARGET_SUBMIT | null;

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

