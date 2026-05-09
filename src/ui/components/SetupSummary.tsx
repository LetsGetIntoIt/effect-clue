"use client";

import * as RadixPopover from "@radix-ui/react-popover";
import { useTranslations } from "next-intl";
import { useId, useMemo, useRef, useState } from "react";
import {
    setupSelfPlayerSet,
    setupSummaryInlineEdit,
    setupSummaryJumpedToWizard,
} from "../../analytics/events";
import { allCardIds, caseFileSize } from "../../logic/CardSet";
import {
    disambiguateName,
    type GameSetup,
} from "../../logic/GameSetup";
import { Player, type Player as PlayerId } from "../../logic/GameObjects";
import { useClue } from "../state";
import { useSetupWizardFocus } from "../setup/SetupWizardFocusContext";
import type { WizardStepId } from "../setup/wizardSteps";

// Module-scope discriminators: both the analytics field tag and the
// WizardStepId values. Hoisted so the i18next/no-literal-string lint
// treats them as identifiers, not user-facing copy.
const FIELD_PLAYER_NAME = "playerName" as const;
const FIELD_HAND_SIZE = "handSize" as const;
const FIELD_SELF_PLAYER = "selfPlayer" as const;

const STEP_CARD_PACK: WizardStepId = "cardPack";
const STEP_PLAYERS: WizardStepId = "players";
const STEP_MY_CARDS: WizardStepId = "myCards";
const STEP_KNOWN_CARDS: WizardStepId = "knownCards";

const STORAGE_KEY = "effect-clue.setup-summary.collapsed.v1";

/**
 * Read-at-a-glance summary of the current game's setup, mounted above
 * the play-mode grid. Lets the user tweak small things inline (rename
 * a player, fix a hand size, set themselves) without leaving the play
 * view, and offers "jump to wizard step" buttons for structural
 * changes (add/remove a player, swap the deck, edit my-cards).
 *
 * The component is intentionally compact: a heading + collapse toggle,
 * one row per setup concern. Inline edits use Radix popovers anchored
 * to the row's value/edit button. Jump buttons set a focus hint via
 * `useSetupWizardFocus()` and dispatch `setUiMode("setup")`; the
 * wizard reads the hint on mount and lands the user on the right
 * step.
 *
 * Hides the "My cards" row entirely when `selfPlayerId === null` —
 * per the M6 plan's 0i decision, identity-gated UI is hidden, not
 * shown with apologetic empty-state copy. The identity row is still
 * visible (and offers a "Set yourself" CTA) since it IS the
 * discoverable path back to setting identity.
 */
export function SetupSummary() {
    const t = useTranslations("setupSummary");
    const { state } = useClue();
    const [collapsed, setCollapsed] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        try {
            return window.localStorage.getItem(STORAGE_KEY) === "1";
        } catch {
            return false;
        }
    });

    const toggle = () => {
        setCollapsed(prev => {
            const next = !prev;
            try {
                window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
            } catch {
                // Quota / private mode — non-fatal.
            }
            return next;
        });
    };

    const showMyCards = state.selfPlayerId !== null;

    return (
        <section
            aria-label={t("heading")}
            data-setup-summary=""
            // contain-inline-size: stops the wrapped chip rows below
            // from propagating their no-wrap intrinsic size up into
            // `<main>`'s `min-w-max` sizing — same pattern as
            // SuggestionLogPanel uses on its pill row (CLAUDE.md →
            // "Mobile Suggest pane fits the viewport").
            className="contain-inline-size rounded border border-border/40 bg-panel/60 px-3 py-2 text-[13px]"
        >
            <header className="flex items-center justify-between gap-2">
                <h2 className="m-0 text-[14px] font-semibold tracking-tight">
                    {t("heading")}
                </h2>
                <button
                    type="button"
                    className="cursor-pointer rounded border border-border bg-bg px-2 py-0.5 text-[12px] hover:bg-hover"
                    aria-expanded={!collapsed}
                    onClick={toggle}
                >
                    {collapsed ? t("toggleExpand") : t("toggleCollapse")}
                </button>
            </header>
            {!collapsed && (
                <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
                    <CardPackRow />
                    <PlayersRow />
                    <IdentityRow />
                    <HandSizesRow />
                    {showMyCards && <MyCardsRow />}
                    <KnownCardsRow />
                </ul>
            )}
        </section>
    );
}

/**
 * Hook that wires a "jump to wizard step" click. Sets the focus hint
 * (so the wizard expands the requested step on mount) and dispatches
 * `setUiMode("setup")`. Falls back to a plain mode switch when the
 * provider isn't available.
 */
function useJumpToWizardStep(): (step: WizardStepId) => void {
    const { dispatch } = useClue();
    const focus = useSetupWizardFocus();
    return (step: WizardStepId) => {
        focus?.setFocusOnNextMount(step);
        setupSummaryJumpedToWizard({ step });
        dispatch({ type: "setUiMode", mode: "setup" });
    };
}

// ── Rows ────────────────────────────────────────────────────────────────

function Row({
    label,
    children,
}: {
    readonly label: string;
    readonly children: React.ReactNode;
}) {
    return (
        <li className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-0.5">
            <span className="shrink-0 text-[12px] uppercase tracking-wide text-muted">
                {label}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                {children}
            </div>
        </li>
    );
}

function CardPackRow() {
    const t = useTranslations("setupSummary.cardPack");
    const jump = useJumpToWizardStep();
    const { state } = useClue();
    const setup = state.setup;
    const cardCount = setup.categories.reduce(
        (acc, c) => acc + c.cards.length,
        0,
    );
    const summary =
        setup.categories.length === 0
            ? t("summaryEmpty")
            : t("summary", {
                  categories: setup.categories.length,
                  cards: cardCount,
              });

    return (
        <Row label={t("label")}>
            <span className="truncate text-[13px]">{summary}</span>
            <button
                type="button"
                className="cursor-pointer rounded border border-border bg-bg px-2 py-0.5 text-[12px] hover:bg-hover"
                onClick={() => jump(STEP_CARD_PACK)}
            >
                {t("edit")}
            </button>
        </Row>
    );
}

function PlayersRow() {
    const t = useTranslations("setupSummary.players");
    const jump = useJumpToWizardStep();
    const { state } = useClue();
    const players = state.setup.players;
    const summary =
        players.length === 0
            ? t("summaryEmpty")
            : t("summary", { count: players.length });

    return (
        <Row label={t("label")}>
            <span className="text-[13px] text-muted">{summary}</span>
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {players.map(player => (
                    <li key={String(player)}>
                        <PlayerNameChip player={player} />
                    </li>
                ))}
            </ul>
            <button
                type="button"
                className="shrink-0 cursor-pointer rounded border border-border bg-bg px-2 py-0.5 text-[12px] hover:bg-hover"
                onClick={() => jump(STEP_PLAYERS)}
            >
                {t("addOrRemove")}
            </button>
        </Row>
    );
}

/**
 * One player's name rendered as a clickable chip. Clicking opens a
 * Radix popover with a text input; submit dispatches `renamePlayer`
 * with disambiguation against the other players' names.
 */
function PlayerNameChip({ player }: { readonly player: PlayerId }) {
    const t = useTranslations("setupSummary.players");
    const { state, dispatch } = useClue();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const inputId = useId();

    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<string>(String(player));

    const onOpenChange = (next: boolean) => {
        setOpen(next);
        if (next) {
            setDraft(String(player));
        }
    };

    const submit = () => {
        const trimmed = draft.trim();
        if (trimmed.length === 0) {
            setOpen(false);
            return;
        }
        if (trimmed === String(player)) {
            setOpen(false);
            return;
        }
        const others = state.setup.players
            .filter(p => p !== player)
            .map(p => String(p));
        const finalName = disambiguateName(trimmed, others);
        const newName = Player(finalName);
        dispatch({
            type: "renamePlayer",
            oldName: player,
            newName,
        });
        setupSummaryInlineEdit({ field: FIELD_PLAYER_NAME });
        setOpen(false);
    };

    return (
        <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
            <RadixPopover.Trigger asChild>
                <button
                    type="button"
                    className="cursor-pointer rounded-full border border-border bg-bg px-2.5 py-0.5 text-[12px] hover:bg-hover"
                    aria-label={t("renameAria", { player: String(player) })}
                    title={t("renameTitle", { player: String(player) })}
                >
                    {String(player)}
                </button>
            </RadixPopover.Trigger>
            <RadixPopover.Portal>
                <RadixPopover.Content
                    side="bottom"
                    align="start"
                    sideOffset={6}
                    collisionPadding={8}
                    onOpenAutoFocus={e => {
                        e.preventDefault();
                        inputRef.current?.focus();
                        inputRef.current?.select();
                    }}
                    className="z-[var(--z-popover)] w-[min(90vw,260px)] rounded-[var(--radius)] border border-border bg-panel p-2 shadow-[0_6px_16px_rgba(0,0,0,0.18)] focus:outline-none"
                >
                    <form
                        className="flex flex-col gap-2"
                        onSubmit={e => {
                            e.preventDefault();
                            submit();
                        }}
                    >
                        <label
                            htmlFor={inputId}
                            className="text-[12px] text-muted"
                        >
                            {t("renameInputLabel")}
                        </label>
                        <input
                            ref={inputRef}
                            id={inputId}
                            type="text"
                            value={draft}
                            onChange={e => setDraft(e.currentTarget.value)}
                            className="w-full rounded border border-border bg-white px-2 py-1 text-[13px] focus:border-accent focus:outline-none"
                        />
                        <div className="flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="cursor-pointer rounded border border-border bg-bg px-2 py-0.5 text-[12px] hover:bg-hover"
                            >
                                {t("renameCancel")}
                            </button>
                            <button
                                type="submit"
                                className="cursor-pointer rounded border-none bg-accent px-2 py-0.5 text-[12px] text-white hover:bg-accent-hover"
                            >
                                {t("renameSave")}
                            </button>
                        </div>
                    </form>
                </RadixPopover.Content>
            </RadixPopover.Portal>
        </RadixPopover.Root>
    );
}

function IdentityRow() {
    const t = useTranslations("setupSummary.identity");
    const { state, dispatch } = useClue();
    const players = state.setup.players;
    const selfPlayer = state.selfPlayerId;
    const inputRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);

    const choose = (next: PlayerId | null) => {
        dispatch({ type: "setSelfPlayer", player: next });
        setupSelfPlayerSet({ cleared: next === null });
        setupSummaryInlineEdit({ field: FIELD_SELF_PLAYER });
        setOpen(false);
    };

    const summary =
        selfPlayer === null
            ? t("summaryUnset")
            : t("summary", { player: String(selfPlayer) });

    return (
        <Row label={t("label")}>
            <span className="text-[13px]">{summary}</span>
            <RadixPopover.Root open={open} onOpenChange={setOpen}>
                <RadixPopover.Trigger asChild>
                    <button
                        type="button"
                        className="cursor-pointer rounded border border-border bg-bg px-2 py-0.5 text-[12px] hover:bg-hover"
                    >
                        {t("setSelf")}
                    </button>
                </RadixPopover.Trigger>
                <RadixPopover.Portal>
                    <RadixPopover.Content
                        ref={inputRef}
                        side="bottom"
                        align="end"
                        sideOffset={6}
                        collisionPadding={8}
                        className="z-[var(--z-popover)] w-[min(90vw,280px)] rounded-[var(--radius)] border border-border bg-panel p-3 shadow-[0_6px_16px_rgba(0,0,0,0.18)] focus:outline-none"
                    >
                        <div className="flex flex-col gap-2">
                            <p className="m-0 text-[12px] text-muted">
                                {t("popoverHint")}
                            </p>
                            {players.length === 0 ? (
                                <p className="m-0 text-[13px] text-muted">
                                    {t("noPlayersHint")}
                                </p>
                            ) : (
                                <div
                                    role="radiogroup"
                                    aria-label={t("popoverTitle")}
                                    className="flex flex-wrap gap-1.5"
                                >
                                    <button
                                        type="button"
                                        role="radio"
                                        aria-checked={selfPlayer === null}
                                        className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-[12px] ${
                                            selfPlayer === null
                                                ? "border-accent bg-accent text-white hover:bg-accent-hover"
                                                : "border-border bg-bg text-fg hover:bg-hover"
                                        }`}
                                        onClick={() => choose(null)}
                                    >
                                        {t("clearOption")}
                                    </button>
                                    {players.map(player => {
                                        const active = selfPlayer === player;
                                        return (
                                            <button
                                                key={String(player)}
                                                type="button"
                                                role="radio"
                                                aria-checked={active}
                                                className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-[12px] ${
                                                    active
                                                        ? "border-accent bg-accent text-white hover:bg-accent-hover"
                                                        : "border-border bg-bg text-fg hover:bg-hover"
                                                }`}
                                                onClick={() => choose(player)}
                                            >
                                                {String(player)}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </RadixPopover.Content>
                </RadixPopover.Portal>
            </RadixPopover.Root>
        </Row>
    );
}

function HandSizesRow() {
    const t = useTranslations("setupSummary.handSizes");
    const { state } = useClue();
    const players = state.setup.players;
    const handSizeMap = useMemo(
        () => new Map(state.handSizes),
        [state.handSizes],
    );
    const setSizes = players
        .map(p => handSizeMap.get(p))
        .filter((n): n is number => typeof n === "number");
    const allSet = setSizes.length === players.length && players.length > 0;
    const totalEntered = setSizes.reduce((a, b) => a + b, 0);
    const expected = totalDealt(state.setup);

    const summary = (() => {
        if (players.length === 0) return t("summaryNoPlayers");
        if (!allSet) return t("summaryPartial");
        return t("summary", { total: totalEntered });
    })();

    const mismatch =
        allSet && totalEntered !== expected ? (
            <span className="text-[12px] text-warning">
                {t("mismatch", { total: totalEntered, expected })}
            </span>
        ) : null;

    return (
        <Row label={t("label")}>
            <span className="text-[13px]">{summary}</span>
            {mismatch}
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                {players.map(player => (
                    <li key={String(player)}>
                        <HandSizeChip player={player} />
                    </li>
                ))}
            </ul>
        </Row>
    );
}

function totalDealt(setup: GameSetup): number {
    return allCardIds(setup).length - caseFileSize(setup);
}

function HandSizeChip({ player }: { readonly player: PlayerId }) {
    const t = useTranslations("setupSummary.handSizes");
    const { state, dispatch } = useClue();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const inputId = useId();
    const [open, setOpen] = useState(false);
    const handSizeMap = useMemo(
        () => new Map(state.handSizes),
        [state.handSizes],
    );
    const current = handSizeMap.get(player);
    const [draft, setDraft] = useState<string>(
        current === undefined ? "" : String(current),
    );

    const onOpenChange = (next: boolean) => {
        setOpen(next);
        if (next) {
            setDraft(current === undefined ? "" : String(current));
        }
    };

    const submit = () => {
        const trimmed = draft.trim();
        if (trimmed === "") {
            dispatch({ type: "setHandSize", player, size: undefined });
            setupSummaryInlineEdit({ field: FIELD_HAND_SIZE });
            setOpen(false);
            return;
        }
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n < 0) {
            return;
        }
        dispatch({ type: "setHandSize", player, size: n });
        setupSummaryInlineEdit({ field: FIELD_HAND_SIZE });
        setOpen(false);
    };

    const label =
        current === undefined ? "—" : String(current);

    return (
        <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
            <RadixPopover.Trigger asChild>
                <button
                    type="button"
                    className="cursor-pointer rounded-full border border-border bg-bg px-2 py-0.5 text-[12px] hover:bg-hover"
                    aria-label={t("editAria", { player: String(player) })}
                    title={t("editTitle", { player: String(player) })}
                >
                    {String(player)}: {label}
                </button>
            </RadixPopover.Trigger>
            <RadixPopover.Portal>
                <RadixPopover.Content
                    side="bottom"
                    align="end"
                    sideOffset={6}
                    collisionPadding={8}
                    onOpenAutoFocus={e => {
                        e.preventDefault();
                        inputRef.current?.focus();
                        inputRef.current?.select();
                    }}
                    className="z-[var(--z-popover)] w-[min(90vw,220px)] rounded-[var(--radius)] border border-border bg-panel p-2 shadow-[0_6px_16px_rgba(0,0,0,0.18)] focus:outline-none"
                >
                    <form
                        className="flex flex-col gap-2"
                        onSubmit={e => {
                            e.preventDefault();
                            submit();
                        }}
                    >
                        <label
                            htmlFor={inputId}
                            className="text-[12px] text-muted"
                        >
                            {t("popoverInputLabel", { player: String(player) })}
                        </label>
                        <input
                            ref={inputRef}
                            id={inputId}
                            type="number"
                            min={0}
                            value={draft}
                            onChange={e => setDraft(e.currentTarget.value)}
                            className="w-full rounded border border-border bg-white px-2 py-1 text-[13px] focus:border-accent focus:outline-none"
                        />
                        <div className="flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="cursor-pointer rounded border border-border bg-bg px-2 py-0.5 text-[12px] hover:bg-hover"
                            >
                                {t("cancel")}
                            </button>
                            <button
                                type="submit"
                                className="cursor-pointer rounded border-none bg-accent px-2 py-0.5 text-[12px] text-white hover:bg-accent-hover"
                            >
                                {t("save")}
                            </button>
                        </div>
                    </form>
                </RadixPopover.Content>
            </RadixPopover.Portal>
        </RadixPopover.Root>
    );
}

function MyCardsRow() {
    const t = useTranslations("setupSummary.myCards");
    const jump = useJumpToWizardStep();
    const { state } = useClue();
    const selfPlayer = state.selfPlayerId;
    const myCount =
        selfPlayer === null
            ? 0
            : state.knownCards.filter(kc => kc.player === selfPlayer).length;

    const summary =
        myCount === 0 ? t("summaryEmpty") : t("summary", { count: myCount });

    return (
        <Row label={t("label")}>
            <span className="text-[13px]">{summary}</span>
            <button
                type="button"
                className="cursor-pointer rounded border border-border bg-bg px-2 py-0.5 text-[12px] hover:bg-hover"
                onClick={() => jump(STEP_MY_CARDS)}
            >
                {t("edit")}
            </button>
        </Row>
    );
}

function KnownCardsRow() {
    const t = useTranslations("setupSummary.knownCards");
    const jump = useJumpToWizardStep();
    const { state } = useClue();
    const selfPlayer = state.selfPlayerId;
    const otherCount = state.knownCards.filter(
        kc => kc.player !== selfPlayer,
    ).length;

    const summary =
        otherCount === 0
            ? t("summaryEmpty")
            : t("summary", { count: otherCount });

    return (
        <Row label={t("label")}>
            <span className="text-[13px]">{summary}</span>
            <button
                type="button"
                className="cursor-pointer rounded border border-border bg-bg px-2 py-0.5 text-[12px] hover:bg-hover"
                onClick={() => jump(STEP_KNOWN_CARDS)}
            >
                {t("edit")}
            </button>
        </Row>
    );
}
