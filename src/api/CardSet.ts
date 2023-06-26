import { B, HS, E, ROA } from './utils/EffectImports';
import { flow, pipe, apply } from '@effect/data/Function';
import { Brand_refined, Endomorphism_getMonoid } from './utils/Effect';

import * as Card from './Card';

export type CardSet = B.Branded<HS.HashSet<Card.ValidatedCard>, 'CardSet'>;

const CardSet = B.nominal<CardSet>();

export const add = (card: Card.ValidatedCard): ((cards: CardSet) => CardSet) =>
    flow(HS.add(card), CardSet);

export type ValidatedCardSet = CardSet & B.Brand<'ValidatedCardSet'>;

export const ValidatedCardSet = Brand_refined<ValidatedCardSet>([
    // TODO check that there is at least 1 card? Is that necessary?
]);

export const empty: ValidatedCardSet = pipe(
    HS.empty(),
    CardSet,
    ValidatedCardSet,
    E.getOrThrow,
);

export const northAmerica: ValidatedCardSet = pipe(
    [
        Card.Card({ cardType: 'Suspect', label: 'Miss Scarlet' }),
        Card.Card({ cardType: 'Suspect', label: 'Col. Mustard' }),
        Card.Card({ cardType: 'Suspect', label: 'Mrs. White' }),
        Card.Card({ cardType: 'Suspect', label: 'Mr. Green' }),
        Card.Card({ cardType: 'Suspect', label: 'Mrs. Peacock' }),
        Card.Card({ cardType: 'Suspect', label: 'Prof. Plum' }),

        Card.Card({ cardType: 'Weapon', label: 'Candlestick' }),
        Card.Card({ cardType: 'Weapon', label: 'Knife' }),
        Card.Card({ cardType: 'Weapon', label: 'Lead pipe' }),
        Card.Card({ cardType: 'Weapon', label: 'Revolver' }),
        Card.Card({ cardType: 'Weapon', label: 'Rope' }),
        Card.Card({ cardType: 'Weapon', label: 'Wrench' }),

        Card.Card({ cardType: 'Room', label: 'Kitchen' }),
        Card.Card({ cardType: 'Room', label: 'Ball room' }),
        Card.Card({ cardType: 'Room', label: 'Conservatory' }),
        Card.Card({ cardType: 'Room', label: 'Dining room' }),
        Card.Card({ cardType: 'Room', label: 'Billiard room' }),
        Card.Card({ cardType: 'Room', label: 'Library' }),
        Card.Card({ cardType: 'Room', label: 'Lounge' }),
        Card.Card({ cardType: 'Room', label: 'Hall' }),
        Card.Card({ cardType: 'Room', label: 'Study' }),
    ],

    // Validate the individual cards
    ROA.map(Card.ValidatedCard),
    ROA.sequence(E.Applicative),
    E.getOrThrow, // Any errors should fail the program, because it's a basic code bug

    // Add all these cards to an empty set
    ROA.map(add),
    Endomorphism_getMonoid<CardSet>().combineAll,
    apply(empty),

    // Validate the set
    ValidatedCardSet,
    E.getOrThrow, // Any errors should fail the program, because it's a basic code bug
);
