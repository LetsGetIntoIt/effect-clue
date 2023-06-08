import * as E from '@effect/data/Either';
import * as HS from "@effect/data/HashSet";
import * as ST from "@effect/data/Struct";
import * as ROA from '@effect/data/ReadonlyArray';
import { pipe, flow } from '@effect/data/Function';

import * as Card from './Card';
import { combineApply } from '../utils/ShouldBeBuiltin';

export interface CardSetup {
    readonly cards: HS.HashSet<Card.Card>;
}

export const empty: CardSetup =
    Object.freeze({
        cards: HS.empty(),
    });

export const add = (newCard: Card.Card) =>
                (initialSetup: CardSetup):
                CardSetup =>
    ST.evolve(initialSetup, {
        cards: HS.add(newCard)
    });

export const standardNorthAmericaCardSetup: (initialCardSetup: CardSetup) => CardSetup =
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

        // Add all these cards to a setup, and validate it
        ROA.map(add),
        combineApply,
    );

export interface ValidatedCardSetup extends CardSetup {
    validated: true;
    cardTypes: HS.HashSet<string>;
}

export const validate = (cardSetup: CardSetup): E.Either<string, ValidatedCardSetup> =>
    E.right(
        // TODO validate the card setup for real

        Object.freeze({
            ...cardSetup,
            cardTypes: HS.map(cardSetup.cards, card => card.cardType),
            validated: true,
        })
    );
