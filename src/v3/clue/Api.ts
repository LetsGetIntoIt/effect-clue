import * as E from '@effect/data/Either';
import * as ROA from '@effect/data/ReadonlyArray';
import * as O from '@effect/data/Option';
import * as Match from "@effect/match"
import * as HS from '@effect/data/HashSet';
import { flow, identity, pipe, tupled } from '@effect/data/Function';

import { Endomorphism_getMonoid, eitherApply } from '../utils/ShouldBeBuiltin';

import * as Card from './Card';
import * as CardSet from './CardSet';
import * as Player from './Player';
import * as PlayerSet from './PlayerSet';
import * as Guess from './Guess';
import * as GuessSet from './GuessSet';

type RawCard = [string, string];

export const setupCards = ({
    useStandard,
    extraCards = [],
}: {
    useStandard?: 'North America';
    extraCards?: RawCard[];
}): E.Either<string[], CardSet.ValidatedCardSet> => pipe(
    CardSet.empty,

    // Add whatever standard set was selected, if any
    pipe(
        Match.value(useStandard),

        // If no standard set is selected, leave the set untouched
        Match.when(undefined, () => identity<CardSet.CardSet>),
        
        // Otherwise, add the selected standard set
        Match.when('North America', () => CardSet.addStandardNorthAmericaCardSet),

        Match.exhaustive,
    ),

    // Add any extra user-defined cards
    pipe(
        // Create the cards
        E.validateAll(extraCards, tupled(Card.create)),

        // Add the cards
        E.map(flow(
            ROA.map(CardSet.add),
            Endomorphism_getMonoid<CardSet.CardSet>().combineAll,
        )),

        eitherApply,
    ),

    // Validate the card set
    E.flatMap(CardSet.validate),
);

type RawPlayer = [string];

export const setupPlayers = ({
    names = [],
}: {
    names?: RawPlayer[];
}): E.Either<string[], PlayerSet.ValidatedPlayerSet> => pipe(
    PlayerSet.empty,
    
    pipe(
        // Create the players
        E.validateAll(names, tupled(Player.create)),

        // Add the players
        E.map(flow(
            ROA.map(PlayerSet.add),
            Endomorphism_getMonoid<PlayerSet.PlayerSet>().combineAll,
        )),

        eitherApply,
    ),

    // Validate the player set
    E.flatMap(PlayerSet.validate),
);

type RawKnownNumCards = [RawPlayer, number];

// TODO use @effect/schema
const parseKnownNumCards: (knownNumCards: RawKnownNumCards) => E.Either<string, [Player.Player, number]> = null;

type RawKnownCardHolder = [RawPlayer, RawCard];

// TODO use @effect/schema
const parseKnownCardHolder: (knownCardHolder: RawKnownCardHolder) => E.Either<string, [Player.Player, Card.Card]> = null;

export const setupKnownConclusions = ({
    knownNumCards = [],
    knownCardHolders = [],
}: {
    knownNumCards?: readonly RawKnownNumCards[];
    knownCardHolders?: RawKnownCardHolder[];
}): E.Either<string[], ConclusionSet.ValidatedConclusionSet> => pipe(
    ConclusionSet.empty,

    // Add the known number of cards
    pipe(
        E.validateAll(knownNumCards, parseKnownNumCards),

        // Add all these guesses to the set
        E.map(flow(
            ROA.map(ConclusionSet.addKnownNumCards),
            Endomorphism_getMonoid<ConclusionSet.ConclusionSet>().combineAll,
        )),

        eitherApply,
    ),

    // Add the known card holders
    pipe(
        E.validateAll(knownCardHolders, parseKnownCardHolder),

        // Add all these guesses to the set
        E.map(flow(
            ROA.map(ConclusionSet.addKnownCardHolder),
            Endomorphism_getMonoid<ConclusionSet.ConclusionSet>().combineAll,
        )),

        eitherApply,
    ),

    // Validate the conclusion set
    E.flatMap(ConclusionSet.validate),
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

// TODO use @effect/schema
const parseGuess: (guess: RawGuess) => E.Either<string, Guess.Guess> = null;

export const setupGuesses = ({
    guesses = [],
}: {
    guesses?: RawGuess[];
}): E.Either<string[], GuessSet.ValidatedGuessSet> => pipe(
    GuessSet.empty,

    // Add the guesses
    pipe(
        // Create the guesses
        E.validateAll(guesses, flow(
            parseGuess,
            E.flatMap(Guess.create),
        )),

        // Add all these guesses to the set
        E.map(flow(
            ROA.map(GuessSet.add),
            Endomorphism_getMonoid<GuessSet.GuessSet>().combineAll,
        )),

        eitherApply,
    ),

    // Validate the guess set
    E.flatMap(GuessSet.validate),
);

export const setupDeductions = null;
export const setupDeducedConclusions = null;
