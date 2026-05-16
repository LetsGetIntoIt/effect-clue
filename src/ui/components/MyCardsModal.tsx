"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import type { Player } from "../../logic/GameObjects";
import { CardSelectionGrid } from "../setup/shared/CardSelectionGrid";
import { useCardSelectionGridProps } from "../setup/shared/useCardSelectionGridProps";
import { useClue } from "../state";
import { XIcon } from "./Icons";
import { useModalStack } from "./ModalStack";

const MODAL_ID = "my-cards-modal";

/**
 * Modal containing a single-column `CardSelectionGrid` for the self
 * player. Opened from null state B of the My Cards surface (identity
 * is set but the user hasn't marked any of their own cards yet), so
 * the user can fill in their hand without leaving the play view for
 * the setup wizard.
 *
 * The grid dispatches `addKnownCard` / `removeKnownCard` on each tick,
 * so there is no "commit" step — the Done button just pops the modal.
 *
 * Uses the `header` / `content` / `footer` slots of `ModalStack` so
 * the title strip and the Done CTA stay pinned while the grid
 * scrolls. The shell also resets the page-level sticky offset CSS
 * variables to 0 on the scrolling body so the grid's sticky `<thead>`
 * (`Player N` / `Identified X of Y in hand`) pins at the top of the
 * modal's body instead of where the page header would sit.
 */
function MyCardsModalBody() {
    const t = useTranslations("myHand");
    const { state } = useClue();
    const selfPlayerId = state.selfPlayerId;
    const players = useMemo<ReadonlyArray<Player>>(
        () => (selfPlayerId === null ? [] : [selfPlayerId]),
        [selfPlayerId],
    );
    const gridProps = useCardSelectionGridProps(players);

    if (selfPlayerId === null) {
        // Defensive: the modal opener gates on selfPlayerId !== null,
        // but a state change between open and render could land here.
        return (
            <p className="m-0 px-5 pt-3 pb-3 text-[1rem] text-muted">
                {t("nullStateAPrompt")}
            </p>
        );
    }

    return (
        <div className="px-5 pt-3 pb-3">
            <CardSelectionGrid players={players} {...gridProps} />
        </div>
    );
}

/**
 * Hook returning an opener for the My Cards modal. Consumers call
 * `open()` from null state B's button; the modal pushes onto the
 * shared `ModalStack` with pinned header (title + close X) and
 * pinned footer (Done CTA).
 */
export function useOpenMyCardsModal(): () => void {
    const { push, pop } = useModalStack();
    const t = useTranslations("myHand");
    const tCommon = useTranslations("common");
    return useCallback(() => {
        const title = t("modalTitle");
        push({
            id: MODAL_ID,
            title,
            header: (
                <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
                    <Dialog.Title className="m-0 font-display text-[1.25rem] text-accent">
                        {title}
                    </Dialog.Title>
                    <button
                        type="button"
                        aria-label={tCommon("close")}
                        onClick={() => pop()}
                        className="-mt-1 -mr-1 cursor-pointer rounded-[var(--radius)] border-none bg-transparent p-1 text-[#2a1f12] hover:bg-hover"
                    >
                        <XIcon size={18} />
                    </button>
                </div>
            ),
            content: <MyCardsModalBody />,
            footer: (
                <div className="flex items-center justify-end gap-2 bg-panel px-5 pt-4 pb-5">
                    <button
                        type="button"
                        onClick={() => pop()}
                        className={
                            "tap-target text-tap cursor-pointer rounded-[var(--radius)] " +
                            "border-2 border-accent bg-accent font-semibold text-white " +
                            "hover:bg-accent-hover"
                        }
                    >
                        {t("modalDone")}
                    </button>
                </div>
            ),
        });
    }, [push, pop, t, tCommon]);
}
