"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import type { Player } from "../../logic/GameObjects";
import { CardSelectionGrid } from "../setup/shared/CardSelectionGrid";
import { useCardSelectionGridProps } from "../setup/shared/useCardSelectionGridProps";
import { useClue } from "../state";
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
        return <p className="m-0 text-[1rem] text-muted">{t("nullStateAPrompt")}</p>;
    }

    return <CardSelectionGrid players={players} {...gridProps} />;
}

/**
 * Hook returning an opener for the My Cards modal. Consumers call
 * `open()` from null state B's button; the modal pushes onto the
 * shared `ModalStack` with a sticky Done footer.
 */
export function useOpenMyCardsModal(): () => void {
    const { push, pop } = useModalStack();
    const t = useTranslations("myHand");
    return useCallback(() => {
        push({
            id: MODAL_ID,
            title: t("modalTitle"),
            content: <MyCardsModalBody />,
            footer: (
                <div className="flex justify-end">
                    <button
                        type="button"
                        className="tap-target-compact text-tap-compact cursor-pointer rounded-[var(--radius)] border border-accent bg-accent px-3 text-white hover:bg-accent-hover"
                        onClick={() => pop()}
                    >
                        {t("modalDone")}
                    </button>
                </div>
            ),
        });
    }, [push, pop, t]);
}
