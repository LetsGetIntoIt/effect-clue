import * as T from '@effect/io/Effect';
import * as E from '@effect/data/Either';
import * as ROA from '@effect/data/ReadonlyArray';
import * as O from '@effect/data/Option';
import * as Match from "@effect/match"
import { identity, pipe, tupled } from '@effect/data/Function';

import * as Card from './clue/Card';
import * as CardSetup from './clue/CardSetup';

const setupCards = ({
    useStandard,
    extraCards,
}: {
    useStandard?: 'North America';
    extraCards?: [string, string][];
}): T.Effect<never, string, CardSetup.ValidatedCardSetup> => pipe(
    CardSetup.empty,

    // Add whatever standard set was selected, if any
    pipe(
        Match.value(useStandard),

        // If no standard set is selected, leave the set untouched
        Match.when(undefined, () => identity<CardSetup.CardSetup>),
        
        // Otherwise, add the selected standard set
        Match.when('North America', () => CardSetup.standardNorthAmericaCardSetup),

        Match.exhaustive,
    ),

    // Add any extra user-defined cards
    cardSetup => pipe(
        // Default to no cards if the argument is not provided
        extraCards,
        O.fromNullable,
        O.getOrElse((): [string, string][] => []),

        // Create the cards
        ROA.map(tupled(Card.create)),
        E.all,

        // Add all these cards to a setup
        E.map(ROA.reduce(
            // Start with an empty cardSetup
            cardSetup,

            // Add each card
            (cardSetup, nextCard) => pipe(
                cardSetup,
                CardSetup.add(nextCard),
            ),
        )),
    ),

    // Validate the card setup
    E.flatMap(CardSetup.validate),
);

const setupPlayers: T.Effect<PlayerSetup> = pipe(
    PlayerSetup.empty(), // TODO maybe it requires one player, or having to build it later
    T.flatMap(PlayerSetup.add(/* player info */)),
    T.flatMap(PlayerSetup.add(/* player info */)),
    T.flatMap(PlayerSetup.add(/* player info */)),
);

const game: T.Effect<Game> = pipe(
    T.all({
        cardSetup: setupCards({
            useStandard: 'North America',
        }),

        playerSetup: setupPlayers,
    }),

    T.flatMap(Game.create),

    // Add each guess
    T.flatMap(pipe(
        Guess.empty(),
        T.flatMap(Guess.addGuesser(/* player info */)),
        T.flatMap(Guess.build),

        T.flatMap(GamT.addGuess),
    )),
);

const deductions: T.Effect<Deductions> = deduce(game);

// Use Game and Deductions to render the UI
