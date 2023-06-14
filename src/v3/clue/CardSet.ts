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
import { Endomorphism_getMonoid, HashSet_every, HashSet_getEquivalence, Refinement_and, Refinement_struct, Show, Show_isShow, Show_showHashSet, Show_symbol } from '../utils/ShouldBeBuiltin';

type RawCardSet = {
    readonly cards: HS.HashSet<Card.Card>;
}

export type CardSet = EQ.Equal & Show & RawCardSet;

export const isCardSet: P.Refinement<unknown, CardSet> =
    pipe(
        Refinement_struct({
            cards: pipe(
                HS.isHashSet,
                P.compose(HashSet_every(Card.isCard)),
            ),
        }),

        Refinement_and(EQ.isEqual),
        Refinement_and(Show_isShow),
    );

export const Equivalence: EQV.Equivalence<CardSet> = ST.getEquivalence({
    cards: HashSet_getEquivalence(Card.Equivalence),
});

export const empty: CardSet =
    Object.freeze({
        cards: HS.empty(),

        [Show_symbol](): string {
            return Show_showHashSet(this.cards);
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
            Card.create('person', 'scarlet'),
            Card.create('person', 'mustard'),
            Card.create('person', 'white'),
            Card.create('person', 'green'),
            Card.create('person', 'peacock'),
            Card.create('person', 'plum'),

            Card.create('weapon', 'candlestick'),
            Card.create('weapon', 'knife'),
            Card.create('weapon', 'pipe'),
            Card.create('weapon', 'revolver'),
            Card.create('weapon', 'rope'),
            Card.create('weapon', 'wrench'),

            Card.create('room', 'kitchen'),
            Card.create('room', 'ballroom'),
            Card.create('room', 'conservatory'),
            Card.create('room', 'dining room'),
            Card.create('room', 'billiard room'),
            Card.create('room', 'library'),
            Card.create('room', 'lounge'),
            Card.create('room', 'hall'),
            Card.create('room', 'study'),
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
