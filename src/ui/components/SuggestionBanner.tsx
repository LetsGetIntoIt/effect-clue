"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    myCardsBannerDismissed,
    myCardsBannerShown,
    type MyCardsBannerKind,
    type MyCardsSurface,
} from "../../analytics/events";
import { cardName } from "../../logic/CardSet";
import type { Card } from "../../logic/GameObjects";
import { useHasKeyboard } from "../hooks/useHasKeyboard";
import { useClue } from "../state";
import { HandOfCardsBadge } from "./Icons";

// Banner-kind tags used as a `data-banner-kind` attribute for tests
// and CSS hooks. Hoisted into named constants so the literal values
// don't trip the i18next no-literal-string lint rule — they're enum
// values, not user-facing copy.
const KIND_SELF: MyCardsBannerKind = "self";
const KIND_CAN_REFUTE: MyCardsBannerKind = "canRefute";
const KIND_CANNOT_REFUTE: MyCardsBannerKind = "cannotRefute";

// i18n key constants for the device-aware reveal hint. Hoisted out
// of the inline ternary for the same reason as the kind tags above
// — they're key names, not user copy, and the lint rule for literal
// strings flags inline ternaries that happen to be string literals.
const REVEAL_HINT_KEY_MOUSE = "revealHintMouse" as const;
const REVEAL_HINT_KEY_TOUCH = "revealHintTouch" as const;

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
    /**
     * Whether the parent surface is currently in its expanded state
     * (cards visible). Drives the `expandedDuringDisplay` analytics
     * flag — the banner records `true` if `expanded` was ever `true`
     * during the banner's visibility window. Defaults to `false`,
     * matching the stacked-teaser context where the parent is
     * collapsed by definition.
     */
    readonly expanded?: boolean;
    /**
     * Analytics tag for the parent surface. `"section"` is the
     * desktop in-flow section; `"fab"` is the mobile FAB entry point
     * (covering both the stacked teaser and the open panel — they're
     * the same surface from the user's perspective). Defaults to
     * `"section"`.
     */
    readonly surface?: MyCardsSurface;
}

/**
 * Computes the banner's `MyCardsBannerKind` (or `null` when the
 * banner shouldn't be visible) from the current draft + self hand.
 * Used by both `SuggestionBanner`'s render path and the analytics
 * lifecycle effect — capturing kind via a hook keeps the two in
 * lockstep and avoids drift between "visible?" and "what kind?".
 */
function useBannerKind(): MyCardsBannerKind | null {
    const { state } = useClue();
    const myCards = useMyCards();
    const selfPlayerId = state.selfPlayerId;
    const draft = state.pendingSuggestion;

    return useMemo<MyCardsBannerKind | null>(() => {
        if (selfPlayerId === null) return null;
        if (draft === null) return null;
        const filledCards = draft.cards.filter(
            (c): c is Card => c !== null,
        );
        if (filledCards.length === 0) return null;

        const intersection = filledCards.filter(c => myCards.has(c));
        const allFilled =
            filledCards.length === state.setup.cardSet.categories.length;
        const isSelfSuggester = draft.suggester === selfPlayerId;

        if (isSelfSuggester) {
            return intersection.length > 0 ? KIND_SELF : null;
        }
        if (intersection.length > 0) return KIND_CAN_REFUTE;
        return allFilled ? KIND_CANNOT_REFUTE : null;
    }, [selfPlayerId, draft, myCards, state.setup.cardSet.categories.length]);
}

/**
 * Boolean form of `<SuggestionBanner />` — returns whether the banner
 * would render visible content for the current draft + self hand.
 * Mirrors the in-component truth table so callers (e.g. the mobile
 * FAB deciding between the circular button and the stacked teaser)
 * can branch without rendering a probe.
 */
export function useSuggestionBannerVisible(): boolean {
    return useBannerKind() !== null;
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
    expanded = false,
    surface = "section",
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
    const myCards = useMyCards();
    const kind = useBannerKind();

    // Analytics lifecycle — fire `shown` when the banner becomes
    // visible, `dismissed` when it stops being visible (or the
    // component unmounts). `expandedDuringDisplay` is the OR-
    // aggregate of `expanded` across the visibility window: true if
    // the parent surface was ever in its expanded state while this
    // banner was visible, false otherwise. The "shown but not
    // expanded" funnel filters dismissed events on
    // `expandedDuringDisplay === false`.
    useBannerLifecycleAnalytics({ kind, surface, expanded });

    if (kind === null) return null;

    const draft = state.pendingSuggestion!;
    const filledCards = draft.cards.filter((c): c is Card => c !== null);
    const setup = state.setup;
    const intersection = filledCards.filter(c => myCards.has(c));

    if (kind === KIND_SELF) {
        if (teaser) {
            return (
                <Banner kind={kind} paused={paused} variant={variant}>
                    <span>{t("selfSuggestingTeaser")}</span>
                    <RevealHint label={t(revealHintKey)} />
                </Banner>
            );
        }
        const names = intersection.map(c => cardName(setup.cardSet, c));
        return (
            <Banner kind={kind} paused={paused} variant={variant}>
                {t.rich("selfSuggesting", {
                    cards: names.join(t("join")),
                    bold: boldChunks,
                })}
            </Banner>
        );
    }

    if (kind === KIND_CAN_REFUTE) {
        if (teaser) {
            return (
                <Banner kind={kind} paused={paused} variant={variant}>
                    <span>{t("canRefuteTeaser")}</span>
                    <RevealHint label={t(revealHintKey)} />
                </Banner>
            );
        }
        const names = intersection.map(c => cardName(setup.cardSet, c));
        return (
            <Banner kind={kind} paused={paused} variant={variant}>
                {t.rich("canRefute", {
                    cards: names.join(t("join")),
                    bold: boldChunks,
                })}
            </Banner>
        );
    }

    // kind === KIND_CANNOT_REFUTE
    return (
        <Banner kind={kind} paused={paused} variant={variant}>
            {t("cannotRefute")}
        </Banner>
    );
}

/**
 * Fires `myCardsBannerShown` when the banner becomes visible,
 * `myCardsBannerDismissed` when it stops being visible. Tracks
 * `expandedDuringDisplay` via a ref aggregated across the
 * visibility window. The dismiss event uses the latest non-null
 * kind seen during the window (banner kind can transition mid-life
 * as the user fills in cards).
 */
function useBannerLifecycleAnalytics({
    kind,
    surface,
    expanded,
}: {
    readonly kind: MyCardsBannerKind | null;
    readonly surface: MyCardsSurface;
    readonly expanded: boolean;
}) {
    // Keep the latest-non-null kind around so the dismiss event can
    // report what was on screen at the end of the visibility window
    // — `kind` itself drops to `null` on the render that ends the
    // window, which is when the dismiss cleanup fires.
    const latestKindRef = useRef<MyCardsBannerKind | null>(kind);
    if (kind !== null) latestKindRef.current = kind;
    const surfaceRef = useRef(surface);
    surfaceRef.current = surface;
    const expandedSeenRef = useRef(false);
    // Track expansion during the current visibility window — set on
    // each render where both the banner is visible AND the parent
    // surface is expanded.
    if (kind !== null && expanded) expandedSeenRef.current = true;

    const visible = kind !== null;
    useEffect(() => {
        if (!visible) return;
        const showKind = latestKindRef.current;
        if (showKind === null) return;
        expandedSeenRef.current = expanded;
        myCardsBannerShown({ kind: showKind, surface: surfaceRef.current });
        return () => {
            const dismissKind = latestKindRef.current ?? showKind;
            myCardsBannerDismissed({
                kind: dismissKind,
                surface: surfaceRef.current,
                expandedDuringDisplay: expandedSeenRef.current,
            });
            // Reset latest-kind so a future visibility window starts
            // fresh. (We don't reset expandedSeenRef here — the
            // visibility-true branch above does, on next show.)
            latestKindRef.current = null;
        };
        // Effect deps intentionally limited to `visible` — the only
        // signal that should tear down + re-emit. `expanded`,
        // `surface`, and the latest kind are read through refs so
        // mid-window changes don't reset the analytics window.
    }, [visible]);
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
    readonly kind: MyCardsBannerKind;
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
                <HandOfCardsBadge size={32} />
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

// Tag callback for `t.rich` — wraps the card-name listing inside a
// `<strong>` so the names visually stand out from the surrounding
// sentence ("You can refute this suggestion with: **Miss Scarlet,
// Knife**"). Defined as a module-level constant so the function
// identity stays stable across renders.
function boldChunks(chunks: React.ReactNode): React.ReactNode {
    return <strong>{chunks}</strong>;
}
