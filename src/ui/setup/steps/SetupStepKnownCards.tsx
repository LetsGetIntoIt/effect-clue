"use client";

import { AnimatePresence, motion, type Variants } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { Player } from "../../../logic/GameObjects";
import { useClue } from "../../state";
import { T_STANDARD, useReducedTransition } from "../../motion";
import { ChevronLeftIcon, ChevronRightIcon } from "../../components/Icons";
import { CardSelectionGrid } from "../shared/CardSelectionGrid";
import { SetupStepPanel } from "../SetupStepPanel";
import { VALID, type WizardStepId } from "../wizardSteps";
import type { StepPanelState, WizardMode } from "../SetupStepPanel";

const STEP_ID = "knownCards" as const;

// Slide-variant identifiers — pulled to module scope so the
// i18next/no-literal-string lint reads them as wire identifiers.
const VARIANT_INITIAL = "initial" as const;
const VARIANT_ANIMATE = "animate" as const;
const VARIANT_EXIT = "exit" as const;

type SlideDirection = 1 | -1;

// Mirror of `slideVariants` in `PlayLayout.tsx` — the paginator slide
// uses the same direction-driven enter-from / exit-to pattern as the
// mobile Checklist ↔ Suggest swap so the motion language is
// consistent across mobile screens.
const playerSlideVariants: Variants = {
    initial: (dir: SlideDirection) => ({
        x: dir === 1 ? "100%" : "-100%",
        opacity: 0,
    }),
    animate: { x: 0, opacity: 1 },
    exit: (dir: SlideDirection) => ({
        x: dir === 1 ? "-100%" : "100%",
        opacity: 0,
    }),
};

interface Props {
    readonly state: StepPanelState;
    readonly wizardMode: WizardMode;
    readonly stepNumber: number;
    readonly onClickToEdit: () => void;
    readonly registerPanelEl?: (
        stepId: WizardStepId,
        el: HTMLElement | null,
    ) => void;
    readonly footer?: React.ReactNode | undefined;
}

/**
 * Step 6 — "Do you know any other player's cards?" (skippable).
 *
 * Iterates non-self players when `selfPlayerId` is set, or every
 * player when it isn't. Layout:
 *
 * - **Desktop (≥ 800px):** a single `<CardSelectionGrid>` with every
 *   relevant player as a column. Per-column "Identified X of Y"
 *   counters appear in the grid header and deduction-driven cell
 *   backgrounds light up as the user enters known cards.
 * - **Mobile (< 800px):** the same grid sliced to a one-player array,
 *   wrapped in a paginator (left / right arrow buttons + a "Player N
 *   of M" indicator) so each column gets its own viewport-width.
 *
 * The grid is the same component in both branches; only its `players`
 * prop changes. `activeIndex` (local state) drives the mobile slice.
 */
export function SetupStepKnownCards({
    state,
    wizardMode,
    stepNumber,
    onClickToEdit,
    registerPanelEl,
    footer,
}: Props) {
    const t = useTranslations("setupWizard.knownCards");
    const { state: clue } = useClue();
    const players = clue.setup.players;
    const selfPlayerId = clue.selfPlayerId;
    const targets =
        selfPlayerId === null
            ? players
            : players.filter(p => p !== selfPlayerId);

    const [activeIndex, setActiveIndex] = useState(0);
    useEffect(() => {
        if (activeIndex >= targets.length) {
            setActiveIndex(Math.max(0, targets.length - 1));
        }
    }, [targets.length, activeIndex]);

    // Direction for the paginator slide: +1 when advancing to a later
    // player, -1 when stepping back. Computed against the previous
    // render's `activeIndex` so AnimatePresence can swap the enter /
    // exit sides correctly. The ref updates AFTER the render that
    // consumed it, so each render sees the right "previous" value.
    const prevIndexRef = useRef(activeIndex);
    const slideDirection: SlideDirection =
        activeIndex >= prevIndexRef.current ? 1 : -1;
    useEffect(() => {
        prevIndexRef.current = activeIndex;
    }, [activeIndex]);
    const transition = useReducedTransition(T_STANDARD, { fadeMs: 120 });

    // `overflow-x: clip` on the slide container is required mid-slide
    // (the off-screen pane's `translateX(±100%)` would otherwise extend
    // `body.scrollWidth` and flash a horizontal scrollbar). But ANY
    // non-`visible` overflow makes the element the nearest scrolling
    // ancestor for sticky positioning of descendants — and the table's
    // sticky thead would pin to the slide container instead of the
    // viewport, dropping behind the body cells. Same toggle pattern as
    // `MobilePlayLayout` in `PlayLayout.tsx`: clip ONLY while the slide
    // is in flight, otherwise drop the clip so the grid's sticky thead
    // resolves to `body` (the page's scroll container).
    const [isSliding, setIsSliding] = useState(false);
    const animationClipClass = isSliding ? " overflow-x-clip" : "";

    const otherKnownCount = clue.knownCards.filter(
        kc => kc.player !== selfPlayerId,
    ).length;
    const summary =
        otherKnownCount === 0
            ? t("summaryEmpty")
            : t("summary", { count: otherKnownCount });

    if (targets.length === 0) {
        return (
            <SetupStepPanel
                stepId={STEP_ID}
                state={state}
                wizardMode={wizardMode}
                stepNumber={stepNumber}
                title={t("title")}
                summary={t("summaryEmpty")}
                validation={VALID}
                onClickToEdit={onClickToEdit}
                registerPanelEl={registerPanelEl}
                footer={footer}
            >
                <p className="m-0 text-[1rem] text-muted">
                    {t("noOtherPlayers")}
                </p>
            </SetupStepPanel>
        );
    }

    const currentPlayer = targets[activeIndex] as Player;

    return (
        <SetupStepPanel
            stepId={STEP_ID}
            state={state}
            wizardMode={wizardMode}
            stepNumber={stepNumber}
            title={t("title")}
            summary={summary}
            validation={VALID}
            onClickToEdit={onClickToEdit}
            registerPanelEl={registerPanelEl}
            footer={footer}
        >
            <p className="m-0 text-[1rem] text-muted">{t("helperText")}</p>

            {/* Desktop: every player as a column in one grid. */}
            <div className="hidden [@media(min-width:800px)]:block">
                <CardSelectionGrid players={targets} />
            </div>

            {/* Mobile: single-player slice + paginator chrome. */}
            <div className="flex flex-col gap-2 [@media(min-width:800px)]:hidden">
                <div className="flex items-center justify-between gap-2">
                    <button
                        type="button"
                        className="cursor-pointer rounded border border-border bg-control p-1.5 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-control"
                        disabled={activeIndex === 0}
                        aria-label={t("prevPlayer")}
                        onClick={() =>
                            setActiveIndex(i => Math.max(0, i - 1))
                        }
                    >
                        <ChevronLeftIcon size={16} />
                    </button>
                    <span className="text-[1rem] text-muted">
                        {t("paginator", {
                            current: activeIndex + 1,
                            total: targets.length,
                            player: String(currentPlayer),
                        })}
                    </span>
                    <button
                        type="button"
                        className="cursor-pointer rounded border border-border bg-control p-1.5 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-control"
                        disabled={activeIndex >= targets.length - 1}
                        aria-label={t("nextPlayer")}
                        onClick={() =>
                            setActiveIndex(i =>
                                Math.min(targets.length - 1, i + 1),
                            )
                        }
                    >
                        <ChevronRightIcon size={16} />
                    </button>
                </div>
                <div
                    className={`relative grid grid-cols-[minmax(0,1fr)] [grid-template-areas:'stack']${animationClipClass}`}
                >
                    <AnimatePresence
                        custom={slideDirection}
                        initial={false}
                        onExitComplete={() => setIsSliding(false)}
                    >
                        <motion.div
                            key={String(currentPlayer)}
                            custom={slideDirection}
                            variants={playerSlideVariants}
                            initial={VARIANT_INITIAL}
                            animate={VARIANT_ANIMATE}
                            exit={VARIANT_EXIT}
                            transition={transition}
                            onAnimationStart={() => setIsSliding(true)}
                            className="[grid-area:stack] min-w-0"
                        >
                            <CardSelectionGrid
                                players={[currentPlayer]}
                            />
                        </motion.div>
                    </AnimatePresence>
                </div>
            </div>
        </SetupStepPanel>
    );
}
