"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { cardName } from "../../logic/CardSet";
import type { Card } from "../../logic/GameObjects";
import { useHasKeyboard } from "../hooks/useHasKeyboard";
import { useClue } from "../state";
import { HandOfCardsIcon } from "./Icons";

// Banner-kind tags used as a `data-banner-kind` attribute for tests
// and CSS hooks. Hoisted into named constants so the literal values
// don't trip the i18next no-literal-string lint rule — they're enum
// values, not user-facing copy.
const KIND_SELF = "self" as const;
const KIND_CAN_REFUTE = "canRefute" as const;
const KIND_CANNOT_REFUTE = "cannotRefute" as const;

// i18n key constants for the device-aware reveal hint. Hoisted out
// of the inline ternary for the same reason as the kind tags above
// — they're key names, not user copy, and the lint rule for literal
// strings flags inline ternaries that happen to be string literals.
const REVEAL_HINT_KEY_MOUSE = "revealHintMouse" as const;
const REVEAL_HINT_KEY_TOUCH = "revealHintTouch" as const;

type BannerKind =
    | typeof KIND_SELF
    | typeof KIND_CAN_REFUTE
    | typeof KIND_CANNOT_REFUTE;

type BannerVariant = "default" | "stacked";

interface Props {
    /**
     * When true, replace card listings with an ellipsis + "click to
     * reveal" hint. Used by the desktop section in its collapsed
     * banner-only mode AND by the mobile stacked teaser so the cards
     * stay hidden until the user expands the surface.
     */
    readonly teaser?: boolean;
    /**
     * When true, the looping attention-bounce animation stops at the
     * banner's resting scale. Used to acknowledge the user has seen
     * the banner — once true, the banner should stay paused for the
     * rest of its lifetime (parent doesn't toggle this back to
     * false; banner unmount + remount resets state).
     */
    readonly paused?: boolean;
    /**
     * Visual treatment. Defaults to `"default"` — a rounded soft-
     * accent banner that sits inside the desktop section or the open
     * mobile panel. `"stacked"` renders as a full-width opaque bar
     * with the hand-of-cards icon on the left, designed to stack
     * directly above the BottomNav as the mobile entry point when
     * the panel is closed but a draft has banner content.
     */
    readonly variant?: BannerVariant;
}

/**
 * Boolean form of `<SuggestionBanner />` — returns whether the banner
 * would render visible content for the current draft + self hand.
 * Mirrors the in-component truth table so callers (e.g. the mobile
 * FAB deciding between the circular button and the stacked teaser)
 * can branch without rendering a probe.
 */
export function useSuggestionBannerVisible(): boolean {
    const { state } = useClue();
    const myCards = useMyCards();

    const selfPlayerId = state.selfPlayerId;
    const draft = state.pendingSuggestion;
    if (selfPlayerId === null) return false;
    if (draft === null) return false;

    const filledCards = draft.cards.filter((c): c is Card => c !== null);
    if (filledCards.length === 0) return false;

    const intersection = filledCards.filter(c => myCards.has(c));
    const allFilled =
        filledCards.length === state.setup.cardSet.categories.length;
    const isSelfSuggester = draft.suggester === selfPlayerId;

    if (isSelfSuggester) return intersection.length > 0;
    if (intersection.length > 0) return true;
    return allFilled;
}

/**
 * Suggestion-aware banner that lives at the top of the My Cards
 * surface (desktop section + mobile FAB panel + mobile stacked
 * teaser). Tells the user how the current suggestion draft relates
 * to the cards in their hand:
 *
 *   - Non-self suggester, intersection has cards → "You can refute
 *     this suggestion with: <cards>". Shown as soon as the
 *     intersection is non-empty, including during a partial draft.
 *   - Non-self suggester, intersection empty:
 *       * Partial draft (< all categories filled) → hidden. Avoids
 *         the false-negative trap mid-draft.
 *       * Complete draft (all categories filled) → "You cannot refute
 *         this suggestion."
 *   - Self suggester, intersection non-empty → "You are suggesting
 *     from your hand: <cards>".
 *   - Self suggester, intersection empty → hidden. No useful copy.
 *   - No identity / no draft / zero slots filled → hidden.
 *
 * Reads `useClue()` directly so callers don't have to thread state.
 *
 * Project 4 (teach-me mode) will gate the entire render on
 * `!state.teachMode` — keep this component as the single integration
 * seam for that.
 */
export function SuggestionBanner({
    teaser = false,
    paused = false,
    variant = "default",
}: Props = {}) {
    const t = useTranslations("refuteHint");
    const hasKeyboard = useHasKeyboard();
    // Device-aware reveal hint copy — "(click to reveal)" on
    // mouse/keyboard devices, "(tap to reveal)" on touch. The same
    // banner instance can render in either context (desktop section
    // collapsed; mobile stacked teaser), so the switch happens here,
    // not at the call site.
    const revealHintKey = hasKeyboard
        ? REVEAL_HINT_KEY_MOUSE
        : REVEAL_HINT_KEY_TOUCH;
    const { state } = useClue();
    const selfPlayerId = state.selfPlayerId;
    const draft = state.pendingSuggestion;
    const myCards = useMyCards();

    const filledCards = useMemo<ReadonlyArray<Card>>(() => {
        if (draft === null) return [];
        return draft.cards.filter((c): c is Card => c !== null);
    }, [draft]);

    const intersection = useMemo<ReadonlyArray<Card>>(() => {
        if (filledCards.length === 0) return [];
        return filledCards.filter(card => myCards.has(card));
    }, [filledCards, myCards]);

    if (selfPlayerId === null) return null;
    if (draft === null) return null;
    if (filledCards.length === 0) return null;

    const allFilled =
        filledCards.length === state.setup.cardSet.categories.length;
    const isSelfSuggester = draft.suggester === selfPlayerId;
    const setup = state.setup;

    // Self-suggester case: only useful when something the user is
    // suggesting is actually in their hand. No copy for the empty case.
    if (isSelfSuggester) {
        if (intersection.length === 0) return null;
        if (teaser) {
            return (
                <Banner kind={KIND_SELF} paused={paused} variant={variant}>
                    <span>{t("selfSuggestingTeaser")}</span>
                    <RevealHint label={t(revealHintKey)} />
                </Banner>
            );
        }
        const names = intersection.map(c => cardName(setup.cardSet, c));
        return (
            <Banner kind={KIND_SELF} paused={paused} variant={variant}>
                {t("selfSuggesting", { cards: names.join(t("join")) })}
            </Banner>
        );
    }

    // Non-self suggester with a match: show intersection eagerly,
    // including during a partial draft.
    if (intersection.length > 0) {
        if (teaser) {
            return (
                <Banner kind={KIND_CAN_REFUTE} paused={paused} variant={variant}>
                    <span>{t("canRefuteTeaser")}</span>
                    <RevealHint label={t(revealHintKey)} />
                </Banner>
            );
        }
        const names = intersection.map(c => cardName(setup.cardSet, c));
        return (
            <Banner kind={KIND_CAN_REFUTE} paused={paused} variant={variant}>
                {t("canRefute", { cards: names.join(t("join")) })}
            </Banner>
        );
    }

    // Non-self suggester with no match: the definitive "cannot refute"
    // line waits for all slots to be filled — a partial draft might
    // still produce a match in the next slot. No card-listing here,
    // so the teaser mode renders the same copy as the expanded mode.
    if (allFilled) {
        return (
            <Banner kind={KIND_CANNOT_REFUTE} paused={paused} variant={variant}>
                {t("cannotRefute")}
            </Banner>
        );
    }

    return null;
}

/**
 * Module-internal helper used by SuggestionBanner to derive the
 * user's hand. Returns the set of card ids in the current user's
 * hand; empty when identity is unset.
 *
 * Moved here from MyHandPanel.tsx (where it lived as long as the old
 * RefuteHint lived) — the only consumer now is this banner.
 */
function useMyCards(): ReadonlySet<Card> {
    const { state } = useClue();
    return useMemo(() => {
        if (state.selfPlayerId === null) return new Set();
        return new Set(
            state.knownCards
                .filter(kc => kc.player === state.selfPlayerId)
                .map(kc => kc.card),
        );
    }, [state.knownCards, state.selfPlayerId]);
}

function Banner({
    kind,
    paused,
    variant,
    children,
}: {
    readonly kind: BannerKind;
    readonly paused: boolean;
    readonly variant: BannerVariant;
    readonly children: React.ReactNode;
}) {
    // Once the parent says paused=true (user mouse entered the section,
    // or mobile surface that auto-acknowledges), latch it. The banner
    // doesn't un-acknowledge mid-life; the only way to bounce again is
    // a fresh mount (e.g. draft ended and a new draft started with new
    // banner content).
    const [acknowledged, setAcknowledged] = useState(paused);
    useEffect(() => {
        if (paused && !acknowledged) setAcknowledged(true);
    }, [paused, acknowledged]);

    // CSS keyframes animation lives in globals.css (`bannerBounce`).
    // The `animate-banner-bounce` class only emits its animation rule
    // inside `@media (prefers-reduced-motion: no-preference)`, so
    // reduced-motion users see a static banner without any extra
    // gating at this layer.
    const bounceClass = acknowledged ? "" : " animate-banner-bounce";

    if (variant === "stacked") {
        // Mobile stacked teaser — opaque full-width bar that sits
        // directly above the BottomNav. The hand-of-cards icon on
        // the left echoes the FAB visual so users see continuity
        // between the floating button and the stacked entry point.
        // No rounded corners; a top border separates the bar from
        // the parchment above. The bounce animates the whole bar
        // (`origin-center` keeps the scale anchored on the bar's
        // center; the parent's fixed positioning is unaffected).
        return (
            <p
                data-tour-anchor="my-cards-banner"
                data-banner-kind={kind}
                data-banner-variant={variant}
                className={
                    "m-0 flex origin-center items-center gap-3 border-t border-border bg-panel px-4 py-3 text-[1rem] text-fg" +
                    bounceClass
                }
            >
                <HandOfCardsIcon
                    size={22}
                    className="shrink-0 text-accent"
                />
                <span className="min-w-0 flex-1">{children}</span>
            </p>
        );
    }

    return (
        <p
            data-tour-anchor="my-cards-banner"
            data-banner-kind={kind}
            data-banner-variant={variant}
            className={
                "m-0 origin-center rounded border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[1rem] text-fg" +
                bounceClass
            }
        >
            {children}
        </p>
    );
}

function RevealHint({ label }: { readonly label: string }) {
    return <span className="ml-1.5 text-muted">{label}</span>;
}
