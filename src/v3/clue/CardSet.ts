import * as E from '@effect/data/Either';
import * as HS from "@effect/data/HashSet";
import * as ST from "@effect/data/Struct";
import * as ROA from '@effect/data/ReadonlyArray';
import * as CTX from '@effect/data/Context';
import { pipe, flow } from '@effect/data/Function';

import * as Card from './Card';
import { Endomorphism_getMonoid } from '../utils/ShouldBeBuiltin';

export interface CardSet {
    readonly cards: HS.HashSet<Card.Card>;
}

export const Tag = CTX.Tag<CardSet>();

export const empty: CardSet =
    Object.freeze({
        cards: HS.empty(),
    });

export const add = (newCard: Card.Card) =>
                (initialSet: CardSet):
                CardSet =>
    ST.evolve(initialSet, {
        cards: HS.add(newCard)
    });

// TODO make this a direct CardSet (rather than a function to add all the standard cards)
//      then add a function to combine two CardSets
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
        // TODO validate the card set for real

        Object.freeze({
            ...cardSet,
            cardTypes: HS.map(cardSet.cards, card => card.cardType),
            validated: true,
        })
    );
