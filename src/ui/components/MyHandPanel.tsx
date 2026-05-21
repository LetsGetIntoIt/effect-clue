"use client";

import { motion, useReducedMotion } from "motion/react";
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
import { ChevronDownIcon, HandOfCardsBadge } from "./Icons";
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

// Shared layoutId for the morph animation that moves the refute
// banner from its inline-with-header position (collapsed) into the
// body of the panel (expanded). Framer Motion saves the unmounting
// element's layout under this id and animates the new element with
// the same id from that saved rectangle — net effect is the teaser
// banner appears to slide down into the body and grow into the full
// advice panel as the section opens (and back when it closes).
const BANNER_LAYOUT_ID = "my-cards-banner-frame";

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
    const { state } = useClue();
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
    // Gate the layoutId morph on prefers-reduced-motion. Without the
    // gate, Framer's layout animation still animates the transform
    // between positions even when other transitions are disabled —
    // for reduced-motion users we want the teaser to appear/disappear
    // in place at each location, matching how `useReducedTransition`
    // short-circuits the body's height/opacity animation.
    const reducedMotion = useReducedMotion();
    const bannerLayoutId = reducedMotion ? undefined : BANNER_LAYOUT_ID;

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
                <h3 className="m-0 flex shrink-0 items-center gap-2 font-sans! text-[1.125rem] font-bold uppercase tracking-wide text-accent">
                    <HandOfCardsBadge size={28} />
                    {t("title")}
                </h3>
                {/* Header banner is the discoverable hook — it sits
                    INLINE with the title only when the section is
                    collapsed. The teaser copy ("You can refute this
                    suggestion with…") + the empty:hidden trick (when
                    there's no draft, the wrapper disappears) keeps
                    the header visually balanced (title left, chevron
                    right). When the user expands the section the
                    refute content moves into the body below; the
                    layoutId shared with the body slot animates the
                    wrapper from its header position into the body
                    position so the transition reads as one continuous
                    morph. Suppressed in teach-mode — the refute hint
                    is deducer-derived and would defeat the "do the
                    work yourself" promise. */}
                {state.solverMode !== "check" && collapsed && (
                    <BannerSlot
                        collapsed={collapsed}
                        paused={isHovered}
                        onTap={expandFromBanner}
                        layoutId={bannerLayoutId}
                    />
                )}
                <button
                    type="button"
                    className="tap-icon flex shrink-0 cursor-pointer items-center justify-center rounded border border-border bg-control text-fg hover:bg-control-hover"
                    aria-expanded={!collapsed}
                    aria-label={
                        collapsed
                            ? t("expandAriaLabel")
                            : t("collapseAriaLabel")
                    }
                    onClick={toggle}
                >
                    {/* Animate the chevron rotation — one icon (down-
                        pointing at rest), rotated 180° when the
                        section is expanded. Uses motion.span +
                        `transform: rotate(…)` so the rotation
                        interpolates smoothly; a plain `rotate-0` /
                        `rotate-180` toggle wouldn't animate
                        cross-browser because `rotate: 0deg` computes
                        to `none` and isn't interpolatable. */}
                    <span
                        aria-hidden
                        className="flex motion-reduce:transition-none"
                        style={{
                            transform: collapsed
                                ? "rotate(0deg)"
                                : "rotate(180deg)",
                            transition: "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)",
                        }}
                    >
                        <ChevronDownIcon size={18} />
                    </span>
                </button>
            </header>
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
                {/* Body banner — full SuggestionBanner content when
                    the section is expanded. Shares its layoutId with
                    the header slot above; Framer morphs the wrapper
                    rectangle from header-position+teaser-size to
                    body-position+expanded-size while React swaps the
                    content inside. SuggestionBanner returns the
                    RefuteAdvicePanel alone in canRefute (the panel's
                    bolded card-name rows are the same information the
                    full banner sentence would have carried — the
                    sentence is collapsed away as redundant). Gated
                    on state.solverMode !== "check" to match the header slot —
                    the refute hint is deducer-derived and would
                    defeat the "do the work yourself" promise. The
                    empty:hidden trick drops the wrapper from layout
                    when there's no draft so the cards chips below
                    don't sit on top of empty padding. */}
                {!collapsed && state.solverMode !== "check" && (
                    <motion.div
                        {...(bannerLayoutId !== undefined && {
                            layoutId: bannerLayoutId,
                        })}
                        className="mb-2 empty:hidden"
                    >
                        <SuggestionBanner
                            surface={MY_CARDS_SURFACE_SECTION}
                            expanded={true}
                            teaser={false}
                            paused={isHovered}
                        />
                    </motion.div>
                )}
                <MyHandPanelBody />
            </motion.div>
        </section>
    );
}

/**
 * Banner wrapper that sits inline in the header row when the section
 * is collapsed. The wrapper is a tap target — clicking expands the
 * section. When `SuggestionBanner` returns `null` (no draft / no
 * overlap), the wrapper has no children and Tailwind's `empty:hidden`
 * drops it from layout so the header collapses back to title +
 * chevron at the row's edges. The `layoutId` prop pairs this wrapper
 * with the body-side wrapper (mounted only when expanded) so Framer
 * Motion morphs the rectangle between the two positions when the
 * section toggles.
 */
function BannerSlot({
    collapsed,
    paused,
    onTap,
    layoutId,
}: {
    readonly collapsed: boolean;
    readonly paused: boolean;
    readonly onTap: () => void;
    readonly layoutId: string | undefined;
}) {
    const clickable = collapsed;
    return (
        <motion.div
            {...(layoutId !== undefined && { layoutId })}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? onTap : undefined}
            onKeyDown={
                clickable
                    ? e => {
                          if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onTap();
                          }
                      }
                    : undefined
            }
            className={
                "min-w-0 flex-1 empty:hidden" +
                (clickable ? " cursor-pointer" : "")
            }
        >
            <SuggestionBanner
                teaser={collapsed}
                paused={paused}
                surface={MY_CARDS_SURFACE_SECTION}
                expanded={!collapsed}
            />
        </motion.div>
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
                                className="tap-target-compact text-tap-compact cursor-pointer rounded-full border border-border bg-control text-fg hover:bg-control-hover"
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
