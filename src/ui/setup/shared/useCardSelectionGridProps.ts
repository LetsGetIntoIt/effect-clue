"use client";

import { Result } from "effect";
import { useMemo } from "react";
import type { CardSet } from "../../../logic/CardSet";
import type { Player } from "../../../logic/GameObjects";
import { KnownCard } from "../../../logic/InitialKnowledge";
import type { Knowledge } from "../../../logic/Knowledge";
import { useClue } from "../../state";
import { firstDealtHandSizes } from "../firstDealt";

/**
 * Compose the controlled-props bundle for `CardSelectionGrid` from
 * global `useClue()` state. Wizard call sites (`SetupStepMyCards`,
 * `SetupStepKnownCards`) and Project 3's play-mode "Select cards in
 * your hand" modal use this hook; the share-import modal does NOT —
 * its grid is fed from snapshot-derived state because the share isn't
 * applied yet.
 *
 * Hand-size denominator follows the same override ladder the grid
 * itself used pre-refactor:
 *   1. `options.handSizeOverrides?.get(p)` if provided
 *   2. `state.handSizes` (user-pinned values)
 *   3. `firstDealtHandSizes(setup, firstDealtPlayerId)` default
 */
interface CardSelectionGridPropsBundle {
    readonly cardSet: CardSet;
    readonly knownCards: ReadonlyArray<KnownCard>;
    readonly handSizes: ReadonlyMap<Player, number>;
    readonly deductionKnowledge: Knowledge;
    readonly onAddKnownCard: (card: KnownCard) => void;
    readonly onRemoveKnownCard: (index: number) => void;
}

export function useCardSelectionGridProps(
    players: ReadonlyArray<Player>,
    options?: { readonly handSizeOverrides?: ReadonlyMap<Player, number> },
): CardSelectionGridPropsBundle {
    const { state, derived, dispatch } = useClue();
    const setup = state.setup;
    const overrides = options?.handSizeOverrides;

    // Deduction-only knowledge for cell backgrounds. On contradiction,
    // fall back to `initialKnowledge` — the user's manual ticks still
    // paint through (initial knowledge contains the user's known
    // cards), and `GlobalContradictionBanner` handles failure messaging.
    const deductionKnowledge = useMemo<Knowledge>(() => {
        const dr = derived.deductionResult;
        return Result.isSuccess(dr) ? dr.success : derived.initialKnowledge;
    }, [derived.deductionResult, derived.initialKnowledge]);

    const handSizes = useMemo<ReadonlyMap<Player, number>>(() => {
        const result = new Map<Player, number>();
        const dealtDefaults = new Map(
            firstDealtHandSizes(setup, state.firstDealtPlayerId),
        );
        for (const p of players) {
            const override = overrides?.get(p);
            if (override !== undefined) {
                result.set(p, override);
                continue;
            }
            const fromSetup = state.handSizes.find(
                ([h]: readonly [Player, number]) => h === p,
            )?.[1];
            if (fromSetup !== undefined) {
                result.set(p, fromSetup);
                continue;
            }
            result.set(p, dealtDefaults.get(p) ?? 0);
        }
        return result;
    }, [
        players,
        setup,
        state.handSizes,
        state.firstDealtPlayerId,
        overrides,
    ]);

    const onAddKnownCard = useMemo(
        () => (card: KnownCard) => dispatch({ type: "addKnownCard", card }),
        [dispatch],
    );
    const onRemoveKnownCard = useMemo(
        () => (index: number) =>
            dispatch({ type: "removeKnownCard", index }),
        [dispatch],
    );

    return {
        cardSet: setup.cardSet,
        knownCards: state.knownCards,
        handSizes,
        deductionKnowledge,
        onAddKnownCard,
        onRemoveKnownCard,
    };
}
