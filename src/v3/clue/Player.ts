import * as E from '@effect/data/Either';
import * as H from '@effect/data/Hash';
import * as EQ from "@effect/data/Equal";
import * as ST from "@effect/data/Struct";
import * as S from '@effect/data/String';
import * as EQV from '@effect/data/typeclass/Equivalence';
import { Show, Show_symbol } from '../utils/ShouldBeBuiltin';

export interface Player extends EQ.Equal, Show {
    readonly label: string;
}

export const Equivalence: EQV.Equivalence<Player> = ST.getEquivalence({
    label: S.Equivalence,
});

class PlayerImpl implements Player {
    public static readonly _tag: unique symbol = Symbol("Player");

    constructor(
        public readonly label: string,
    ) {
        this.label = label;
    }

    [Show_symbol](): string {
        return this.label;
    }

    [EQ.symbol](that: EQ.Equal): boolean {
        return (that instanceof PlayerImpl) // TODO use a refinement based on the interface, not the class
            && Equivalence(this, that);
    }

    [H.symbol](): number {
        return H.structure({
            ...this
        });
    }
}

export const create = (
    label: string,
): E.Either<string, Player> =>
    // TODO maybe actually validate the player?
    E.right(new PlayerImpl(
        label,
    ));
