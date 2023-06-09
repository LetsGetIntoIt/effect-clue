import * as E from '@effect/data/Either';
import * as ROA from '@effect/data/ReadonlyArray';
import * as O from '@effect/data/Option';
import * as Match from "@effect/match"
import * as HS from '@effect/data/HashSet';
import { flow, identity, pipe, tupled } from '@effect/data/Function';

import * as Card from './clue/Card';
import * as CardSetup from './clue/CardSetup';
import * as Player from './clue/Player';
import * as PlayerSetup from './clue/PlayerSetup';
import * as Guess from './clue/Guess';
import * as GuessHistory from './clue/GuessHistory';
import { Endomorphism_getMonoid, eitherApply } from './utils/ShouldBeBuiltin';

type RawCard = [string, string];

const setupCards = ({
    useStandard,
    extraCards,
}: {
    useStandard?: 'North America';
    extraCards?: RawCard[];
}): E.Either<string[], CardSetup.ValidatedCardSetup> => pipe(
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
    pipe(
        // Default to no cards if the argument is not provided
        extraCards,
        O.fromNullable,
        O.getOrElse((): RawCard[] => []),

        // Create the cards
        E.validateAll(tupled(Card.create)),

        // Add the cards
        E.map(flow(
            ROA.map(CardSetup.add),
            Endomorphism_getMonoid<CardSetup.CardSetup>().combineAll,
        )),

        eitherApply,
    ),

    // Validate the card set
    E.flatMap(CardSetup.validate),
);

type RawPlayer = [string];

const setupPlayers = ({
    names,
}: {
    names?: RawPlayer[];
}): E.Either<string[], PlayerSetup.ValidatedPlayerSetup> => pipe(
    PlayerSetup.empty,
    
    pipe(
        // Default to no cards if the argument is not provided
        names,
        O.fromNullable,
        O.getOrElse((): RawPlayer[] => []),

        // Create the players
        E.validateAll(tupled(Player.create)),

        // Add the players
        E.map(flow(
            ROA.map(PlayerSetup.add),
            Endomorphism_getMonoid<PlayerSetup.PlayerSetup>().combineAll,
        )),

        eitherApply,
    ),

    // Validate the player set
    E.flatMap(PlayerSetup.validate),
);

type RawGuess = {
    cards: RawCard[],
    guesser: RawPlayer,
    nonRefuters: RawPlayer[],
    refutation?: [
        RawPlayer,
        RawCard?
    ],
};

const parseGuess: (guess: RawGuess) => E.Either<string, {
    cards: HS.HashSet<Card.Card>,
    guesser: Player.Player,
    nonRefuters: HS.HashSet<Player.Player>,
    refutation: O.Option<{
        refuter: Player.Player;
        card: O.Option<Card.Card>;
    }>,
}> = null;

const setupGuesses = ({
    guesses,
}: {
    guesses?: RawGuess[];
}): E.Either<string[], GuessHistory.ValidatedGuessHistory> => pipe(
    GuessHistory.empty,

    // Add the guesses
    pipe(
        // Default to no cards if the argument is not provided
        guesses,
        O.fromNullable,
        O.getOrElse((): RawGuess[] => []),

        E.validateAll(flow(
            parseGuess,
            E.flatMap(Guess.create),
        )),

        // Add all these guesses to the history
        E.map(flow(
            ROA.map(GuessHistory.add),
            Endomorphism_getMonoid<GuessHistory.GuessHistory>().combineAll,
        )),

        eitherApply,
    ),

    // Validate the guess history
    E.flatMap(GuessHistory.validate),
);

const ui: E.Either<string[], UiOutput> = E.gen(function* ($) {
    // This will live in a component, returning the validated result or nothing
    const cardSetup = yield* $(setupCards({
        useStandard: 'North America',

        extraCards: [
            ['room', 'doghouse'],
        ],
    }));

    // This will live in a component, returning the validated result or nothing
    const playerSetup = yield* $(setupPlayers({
        names: [
            ['kapil'],
            ['kate'],
        ]
    }));

    // TODO add how many cards each player has

    // This will live in one component, returning the validated result or nothing
    const guessHistory = yield* $(setupGuesses({
        guesses: [

        ],
    }));

    // This will live in the App, and be passed into each component to render extra stuff
    const deductions = yield* $(Deductions.deduce({
        cardSetup,
        playerSetup,
        guesses,
    }));

    // Other features
    // - Who I've shown what (and which card I should show to refute)
    // - Best next guesses to make (not taking map into account)
    // - Best next guesses to make, given you're in a particular room
    // - Test hypotheses to find paradoxes
    // - Percent likelihood
    // - Take the map into account, update which is next best guess to make
    // - Take the map into account, who should I pull away from their goal

    // Return whatever is needed to render the UI
});
