"use client";

import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    myCardsSectionToggled,
    MY_CARDS_SURFACE_SECTION,
    setupSelfPlayerSet,
} from "../../analytics/events";
import { categoryName } from "../../logic/CardSet";
import type { Card, CardCategory } from "../../logic/GameObjects";
import { T_STANDARD, useReducedTransition } from "../motion";
import { useClue } from "../state";
import { ChevronDownIcon, ChevronUpIcon, HandOfCardsIcon } from "./Icons";
import { useOpenMyCardsModal } from "./MyCardsModal";
import {
    SuggestionBanner,
    useSuggestionBannerVisible,
} from "./SuggestionBanner";

const STORAGE_KEY = "effect-clue.my-hand-panel.collapsed.v1";

// Animation target sizes for the collapsible body. Numeric pixel
// values (not rem strings) so motion can interpolate smoothly between
// `0` and the open size — string→number transitions otherwise jump at
// the boundary.
const BODY_OPEN_PADDING_TOP = 6; // 0.375rem
const BODY_OPEN_PADDING_BOTTOM = 6;
const BODY_OPEN_MARGIN_TOP = 6;

/**
 * Always-on My Cards section for the desktop play layout. Persistent
 * reference surface for the cards in the user's hand. Renders the
 * `SuggestionBanner` above a collapsible body — collapse only hides
 * the body (chip row / null states), the banner remains so its
 * refute hint is always reachable.
 *
 * Body states:
 *   - **Null state A** — no identity set. Shows a pill row of players.
 *   - **Null state B** — identity set but no cards marked. Shows a
 *     "Select cards in your hand" button that opens `MyCardsModal`.
 *   - **Populated** — identity set + ≥1 card. Shows the grouped chip
 *     row.
 *
 * The banner runs a looping bounce until the user's mouse enters the
 * section (`paused` flips to true), at which point the bounce
 * latches off for the rest of that banner's lifetime. In collapsed
 * mode, the banner runs in `teaser` form — copy ends with an
 * ellipsis + "(click to reveal)" so the listed cards stay hidden
 * until the user expands the section.
 *
 * The mobile FAB (`MyCardsFAB`) reuses `MyHandPanelBody` and renders
 * its own `<SuggestionBanner paused={true} />` — once the FAB is
 * tapped open, the user has acknowledged the surface so the bounce
 * doesn't continue.
 */
export function MyHandPanel() {
    const t = useTranslations("myHand");
    const sectionRef = useRef<HTMLElement>(null);
    const [collapsed, setCollapsed] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        try {
            return window.localStorage.getItem(STORAGE_KEY) === "1";
        } catch {
            return false;
        }
    });
    const [isHovered, setIsHovered] = useState(false);

    useEffect(() => {
        const el = sectionRef.current;
        if (!el) return;
        const onEnter = () => setIsHovered(true);
        const onLeave = () => setIsHovered(false);
        el.addEventListener("mouseenter", onEnter);
        el.addEventListener("mouseleave", onLeave);
        return () => {
            el.removeEventListener("mouseenter", onEnter);
            el.removeEventListener("mouseleave", onLeave);
        };
    }, []);

    const bannerVisible = useSuggestionBannerVisible();
    const bannerVisibleRef = useRef(bannerVisible);
    bannerVisibleRef.current = bannerVisible;

    const persistCollapsed = (next: boolean) => {
        setCollapsed(next);
        try {
            window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
        } catch {
            // Quota / private mode — non-fatal.
        }
        myCardsSectionToggled({
            surface: MY_CARDS_SURFACE_SECTION,
            expanded: !next,
            bannerShowing: bannerVisibleRef.current,
        });
    };
    const toggle = () => persistCollapsed(!collapsed);
    const expandFromBanner = () => {
        if (collapsed) persistCollapsed(false);
    };

    const bodyTransition = useReducedTransition(T_STANDARD, { fadeMs: 120 });

    return (
        <section
            ref={sectionRef}
            aria-label={t("title")}
            data-tour-anchor="my-cards-section"
            data-my-hand-panel=""
            className="contain-inline-size rounded border border-border/40 bg-panel/60 px-3 py-2 shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
        >
            <header className="flex items-center justify-between gap-2">
                <h3 className="m-0 flex items-center gap-2 font-sans! text-[1.125rem] font-bold uppercase tracking-wide text-accent">
                    <HandOfCardsIcon size={20} className="text-accent" />
                    {t("title")}
                </h3>
                <button
                    type="button"
                    className="tap-icon flex cursor-pointer items-center justify-center rounded border border-border bg-control text-fg hover:bg-hover"
                    aria-expanded={!collapsed}
                    aria-label={
                        collapsed
                            ? t("expandAriaLabel")
                            : t("collapseAriaLabel")
                    }
                    onClick={toggle}
                >
                    {collapsed ? (
                        <ChevronDownIcon size={18} />
                    ) : (
                        <ChevronUpIcon size={18} />
                    )}
                </button>
            </header>
            {/* Banner sits outside the collapsible wrapper so it stays
                visible in banner-only mode. In the collapsed state it
                runs in teaser form (cards hidden behind a "click to
                reveal" hint); tapping the banner is the implicit
                expand affordance. */}
            <BannerSlot
                collapsed={collapsed}
                paused={isHovered}
                onTap={expandFromBanner}
            />
            <motion.div
                data-my-hand-panel-body=""
                initial={false}
                animate={
                    collapsed
                        ? {
                              height: 0,
                              opacity: 0,
                              marginTop: 0,
                              paddingTop: 0,
                              paddingBottom: 0,
                          }
                        : {
                              // eslint-disable-next-line i18next/no-literal-string -- CSS keyword
                              height: "auto",
                              opacity: 1,
                              marginTop: BODY_OPEN_MARGIN_TOP,
                              paddingTop: BODY_OPEN_PADDING_TOP,
                              paddingBottom: BODY_OPEN_PADDING_BOTTOM,
                          }
                }
                transition={bodyTransition}
                style={{ overflow: "hidden" }}
                aria-hidden={collapsed}
            >
                <MyHandPanelBody />
            </motion.div>
        </section>
    );
}

/**
 * Banner wrapper that handles the teaser display + tap-to-expand
 * affordance for the collapsed-but-banner-visible mode. Outside the
 * `MyHandPanel` body wrapper so the banner stays put when the body
 * animates collapsed.
 */
function BannerSlot({
    collapsed,
    paused,
    onTap,
}: {
    readonly collapsed: boolean;
    readonly paused: boolean;
    readonly onTap: () => void;
}) {
    if (collapsed) {
        return (
            <div
                role="button"
                tabIndex={0}
                onClick={onTap}
                onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onTap();
                    }
                }}
                className="mt-1.5 cursor-pointer"
            >
                <SuggestionBanner
                    teaser
                    paused={paused}
                    surface={MY_CARDS_SURFACE_SECTION}
                    expanded={false}
                />
            </div>
        );
    }
    return (
        <div className="mt-1.5">
            <SuggestionBanner
                paused={paused}
                surface={MY_CARDS_SURFACE_SECTION}
                expanded
            />
        </div>
    );
}

/**
 * Shared body for the desktop section's collapsible area and the
 * mobile FAB panel. Renders the non-banner content: null state A
 * (identity picker), null state B (Select-cards button), or the
 * populated chip row. The wrappers handle the banner themselves so
 * the banner can persist across collapse animations.
 */
export function MyHandPanelBody() {
    const t = useTranslations("myHand");
    const { state, dispatch } = useClue();
    const openModal = useOpenMyCardsModal();
    const selfPlayer = state.selfPlayerId;

    const myCards = useMemo<ReadonlyArray<Card>>(() => {
        if (selfPlayer === null) return [];
        return state.knownCards
            .filter(kc => kc.player === selfPlayer)
            .map(kc => kc.card);
    }, [state.knownCards, selfPlayer]);

    const grouped = useMemo(() => {
        if (selfPlayer === null || myCards.length === 0) return [];
        const myCardSet = new Set(myCards);
        return state.setup.cardSet.categories
            .map(category => ({
                id: category.id as CardCategory,
                label: categoryName(state.setup.cardSet, category.id),
                cards: category.cards
                    .filter(entry => myCardSet.has(entry.id))
                    .map(entry => entry.name),
            }))
            .filter(g => g.cards.length > 0);
    }, [state.setup.cardSet, myCards, selfPlayer]);

    if (selfPlayer === null) {
        return (
            <div className="flex flex-col gap-2">
                <p className="m-0 text-[1rem] text-muted">
                    {t("nullStateAPrompt")}
                </p>
                {state.setup.players.length > 0 && (
                    <div
                        className="flex flex-wrap gap-2"
                        data-tour-anchor="my-cards-identity-picker"
                    >
                        {state.setup.players.map(player => (
                            <button
                                key={String(player)}
                                type="button"
                                className="tap-target-compact text-tap-compact cursor-pointer rounded-full border border-border bg-control text-fg hover:bg-hover"
                                onClick={() => {
                                    dispatch({
                                        type: "setSelfPlayer",
                                        player,
                                    });
                                    setupSelfPlayerSet({ cleared: false });
                                }}
                            >
                                {String(player)}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    if (myCards.length === 0) {
        return (
            <div className="flex flex-col gap-2">
                <p className="m-0 text-[1rem] text-muted">
                    {t("nullStateBPrompt")}
                </p>
                <div>
                    <button
                        type="button"
                        data-tour-anchor="my-cards-add-button"
                        className="tap-target-compact text-tap-compact cursor-pointer rounded-[var(--radius)] border border-accent bg-accent px-3 text-white hover:bg-accent-hover"
                        onClick={() => openModal()}
                    >
                        {t("selectCardsButton")}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0">
            {grouped.map(group => (
                <li
                    key={String(group.id)}
                    className="flex items-center gap-1.5 text-[1rem]"
                >
                    {/* Category pill — mirrors the deduction-grid
                        category-header style (bg-category-header,
                        white text, uppercase, tracking-[0.05em]) so
                        the chip row reads in the same visual
                        vocabulary the user has already learned in the
                        grid. */}
                    <span className="rounded bg-category-header px-1.5 py-0 text-[0.75rem] font-semibold uppercase tracking-[0.05em] text-white">
                        {group.label}
                    </span>
                    <span>{group.cards.join(", ")}</span>
                </li>
            ))}
        </ul>
    );
}
