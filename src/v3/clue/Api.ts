import * as E from '@effect/data/Either';
import * as ROA from '@effect/data/ReadonlyArray';
import * as Match from "@effect/match"
import { flow, identity, pipe, tupled } from '@effect/data/Function';

import { Either_fromRefinement, Endomorphism_getMonoid, ReadonlyArray_isArray, eitherApply } from '../utils/ShouldBeBuiltin';

import * as Card from './Card';
import * as CardSet from './CardSet';
import * as Player from './Player';
import * as PlayerSet from './PlayerSet';
import * as Guess from './Guess';
import * as GuessSet from './GuessSet';
import * as DeductionRule from './DeductionRule';
import * as ConclusionMapSet from './ConclusionMapSet';

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

const parseKnownNumCards: (knownNumCards: RawKnownNumCards) => E.Either<string, [Player.Player, number]> = null;

type RawKnownCardOwner = [RawPlayer, RawCard];

const parseKnownCardOwner: (knownCardOwner: RawKnownCardOwner) => E.Either<string, [Player.Player, Card.Card]> = null;

export const setupKnownConclusions = ({
    knownNumCards = [],
    knownCardOwners = [],
}: {
    knownNumCards?: readonly RawKnownNumCards[];
    knownCardOwners?: RawKnownCardOwner[];
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

    // Add the known card owners
    pipe(
        E.validateAll(knownCardOwners, parseKnownCardOwner),

        // Add all these guesses to the set
        E.map(flow(
            ROA.map(ConclusionSet.addOwnership),
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

const ALL_DEDUCTION_RULES = [
    'cardIsHeldAtMostOnce',
    'cardIsHeldAtLeastOnce',
    'cardIsHeldExactlyOnce',
    'playerHasAtMostNumCards',
    'playerHasAtLeastNumCards',
    'playerHasExactlyNumCards',
    'caseFileHasAtMostOnePerCardType',
    'caseFileHasAtLeastOnePerCardType',
    'caseFileHasExactlyOnePerCardType',
    'guessIsRefutedByHeldCard',
] as const;

type RawDeductionRule = typeof ALL_DEDUCTION_RULES[number];

export const setupDeductionRules = (
    rules: 'all' | readonly RawDeductionRule[] = 'all',
): E.Either<string[], DeductionRule.DeductionRule> =>
    pipe(
        // Convert the default list of "all"
        rules,
        rules => typeof rules === 'string'
            ? ALL_DEDUCTION_RULES
            : rules,

        // Convert the selected deduction rule IDs to actual functions
        ROA.map(pipe(
            Match.type<RawDeductionRule>(),

            Match.when('cardIsHeldAtMostOnce', () => DeductionRule.cardIsHeldAtMostOnce),
            Match.when('cardIsHeldAtLeastOnce', () => DeductionRule.cardIsHeldAtLeastOnce),
            Match.when('cardIsHeldExactlyOnce', () => DeductionRule.cardIsHeldExactlyOnce),
            Match.when('playerHasAtMostNumCards', () => DeductionRule.playerHasAtMostNumCards),
            Match.when('playerHasAtLeastNumCards', () => DeductionRule.playerHasAtLeastNumCards),
            Match.when('playerHasExactlyNumCards', () => DeductionRule.playerHasExactlyNumCards),
            Match.when('caseFileHasAtMostOnePerCardType', () => DeductionRule.caseFileHasAtMostOnePerCardType),
            Match.when('caseFileHasAtLeastOnePerCardType', () => DeductionRule.caseFileHasAtLeastOnePerCardType),
            Match.when('caseFileHasExactlyOnePerCardType', () => DeductionRule.caseFileHasExactlyOnePerCardType),
            Match.when('guessIsRefutedByHeldCard', () => DeductionRule.guessIsRefutedByHeldCard),

            Match.exhaustive,
        )),

        // Combine them all into a single deduction rule
        DeductionRule.MonoidUnion.combineAll,

        // This operation is always successful
        E.right,
    );

export const deduceConclusions = (
    conclusions: ConclusionMapSet.ConclusionMapSet
): E.Either<string[], ConclusionMapSet.ConclusionMapSet> =>
    null;
