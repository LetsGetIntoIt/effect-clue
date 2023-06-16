import * as E from '@effect/data/Either';
import * as HS from "@effect/data/HashSet";
import * as ST from "@effect/data/Struct";
import * as ROA from '@effect/data/ReadonlyArray';
import * as EQ from '@effect/data/Equal';
import * as EQV from '@effect/data/typeclass/Equivalence';
import * as P from '@effect/data/Predicate';
import * as H from '@effect/data/Hash';
import { pipe } from '@effect/data/Function';

import * as Card from './Card';
import { Endomorphism_getMonoid, HashSet_every, Refinement_and, Refinement_struct } from '../utils/ShouldBeBuiltin';

type RawCardSet = {
    readonly cards: HS.HashSet<Card.Card>;
}

export type CardSet = EQ.Equal & RawCardSet;

export const isCardSet: P.Refinement<unknown, CardSet> =
    pipe(
        Refinement_struct({
            cards: pipe(
                HS.isHashSet,
                P.compose(HashSet_every(Card.isCard)),
            ),
        }),

        Refinement_and(EQ.isEqual),
    );

export const Equivalence: EQV.Equivalence<CardSet> = ST.getEquivalence({
    cards: EQ.equivalence(),
});

export const empty: CardSet =
    Object.freeze({
        cards: HS.empty(),

        toString() {
            return `${String(this.cards)}`;
        },

        [EQ.symbol](that: EQ.Equal): boolean {
            return isCardSet(that) && Equivalence(this, that);
        },

        [H.symbol](): number {
            return H.structure({
                ...this
            });
        },
    });

export const add = (newCard: Card.Card) =>
                (initialSet: CardSet):
                CardSet =>
    ST.evolve(initialSet, {
        cards: HS.add(newCard)
    });

export const addStandardNorthAmericaCardSet: (initialCardSet: CardSet) => CardSet =
    pipe(
        E.all([
            Card.create({ cardType: 'person', label: 'scarlet' }),
            Card.create({ cardType: 'person', label: 'mustard' }),
            Card.create({ cardType: 'person', label: 'white' }),
            Card.create({ cardType: 'person', label: 'green' }),
            Card.create({ cardType: 'person', label: 'peacock' }),
            Card.create({ cardType: 'person', label: 'plum' }),

            Card.create({ cardType: 'weapon', label: 'candlestick' }),
            Card.create({ cardType: 'weapon', label: 'knife' }),
            Card.create({ cardType: 'weapon', label: 'pipe' }),
            Card.create({ cardType: 'weapon', label: 'revolver' }),
            Card.create({ cardType: 'weapon', label: 'rope' }),
            Card.create({ cardType: 'weapon', label: 'wrench' }),

            Card.create({ cardType: 'room', label: 'kitchen' }),
            Card.create({ cardType: 'room', label: 'ballroom' }),
            Card.create({ cardType: 'room', label: 'conservatory' }),
            Card.create({ cardType: 'room', label: 'dining room' }),
            Card.create({ cardType: 'room', label: 'billiard room' }),
            Card.create({ cardType: 'room', label: 'library' }),
            Card.create({ cardType: 'room', label: 'lounge' }),
            Card.create({ cardType: 'room', label: 'hall' }),
            Card.create({ cardType: 'room', label: 'study' }),
        ]),

        // Any card creation errors that happen here are defects in the underlying code,
        // not tagged errors that should be handled by the user
        E.getOrThrow,

        // Add all these cards to the set
        ROA.map(add),
        Endomorphism_getMonoid<CardSet>().combineAll,
    );

export interface ValidatedCardSet extends CardSet {
    validated: true;
    cardTypes: HS.HashSet<string>;
}

export const validate = (cardSet: CardSet): E.Either<string[], ValidatedCardSet> =>
    E.right(
        Object.freeze({
            ...cardSet,
            cardTypes: HS.map(cardSet.cards, card => card.cardType),
            validated: true,
        })
    );
