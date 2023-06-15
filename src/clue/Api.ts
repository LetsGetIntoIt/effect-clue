import * as E from '@effect/data/Either';
import * as ROA from '@effect/data/ReadonlyArray';
import * as Match from "@effect/match"
import { flow, identity, pipe, tupled } from '@effect/data/Function';

import { Endomorphism_getMonoid } from '../utils/ShouldBeBuiltin';

import * as Card from './Card';
import * as CardSet from './CardSet';
import * as Player from './Player';
import * as CaseFile from './CaseFile';
import * as CardOwnerSet from './CardOwnerSet';
import * as CardOwner from './CardOwner';
import * as Guess from './Guess';
import * as GuessSet from './GuessSet';
import * as DeductionRule from './DeductionRule';
import * as ConclusionMapSet from './ConclusionMapSet';

type RawCard = [string, string];

export const setupCards = ({
    useStandard,
    extraCards: rawExtraCards = [],
}: {
    useStandard?: 'North America';
    extraCards?: RawCard[];
}): E.Either<string[], CardSet.ValidatedCardSet> =>
    E.gen(function* ($) {
        // Add whatever standard set was selected, if any
        const addStandardSet = pipe(
            Match.value(useStandard),

            // If no standard set is selected, leave the set untouched
            Match.when(undefined, () => identity<CardSet.CardSet>),
            
            // Otherwise, add the selected standard set
            Match.when('North America', () => CardSet.addStandardNorthAmericaCardSet),

            Match.exhaustive,
        );

        // Create the extra manual cards
        const extraCards = yield* $(E.validateAll(
            rawExtraCards,
            ([cardType, label]) => Card.create({
                cardType,
                label,
            }),
        ));

        // Create our functiont to add all these manual cards
        const addExtraCards = pipe(
            extraCards,
            ROA.map(CardSet.add),
            Endomorphism_getMonoid<CardSet.CardSet>().combineAll,
        );

        return yield* $(
            CardSet.empty,
            addStandardSet,
            addExtraCards,
            CardSet.validate,
        );
    });

type RawPlayer = [string];
type RawCaseFile = [string];

export const setupCardOwners = ({
    players = [],
    caseFiles = [],
}: {
    players?: RawPlayer[];
    caseFiles?: RawCaseFile[];
}): E.Either<string[], CardOwnerSet.ValidatedCardOwnerSet> =>
    E.gen(function* ($) {
        // Create the players
        const playerOwners = yield* $(E.validateAll(
            players,

            flow(
                ([label]) => ({ label }),
                Player.create,
                E.map(CardOwner.createPlayer),
            ),
        ));

        // Create the case files
        const caseFileOwners = yield* $(E.validateAll(
            caseFiles,

            flow(
                ([label]) => ({ label }),
                CaseFile.create,
                E.map(CardOwner.createCaseFile),
            ),
        ));

        // Create our functiont to add all these owners
        const addAllOwners = pipe(
            playerOwners,
            ROA.appendAll(caseFileOwners),

            ROA.map(CardOwnerSet.add),
            Endomorphism_getMonoid<CardOwnerSet.CardOwnerSet>().combineAll,
        );

        return yield* $(
            CardOwnerSet.empty,
            addAllOwners,
            CardOwnerSet.validate,
        );
    });

type RawGuess = {
    cards: RawCard[],
    guesser: RawPlayer,
    nonRefuters: RawPlayer[],
    refutation?: [
        RawPlayer,
        RawCard?
    ],
};

// TODO actually parse this!
const parseGuess = (guess: RawGuess): E.Either<string, any> =>
    E.left('Not implemented yet');

export const setupGuesses = ({
    guesses: rawGuesses = [],
}: {
    guesses?: RawGuess[];
}): E.Either<string[], GuessSet.ValidatedGuessSet> =>
    E.gen(function* ($) {
        // Create the guesses
        const guesses = yield* $(E.validateAll(
            rawGuesses,

            flow(
                parseGuess,
                E.flatMap(Guess.create),
            )),
        );

        // Create our function to add all the guesses
        const addGuesses = pipe(
            guesses,
            ROA.map(GuessSet.add),
            Endomorphism_getMonoid<GuessSet.GuessSet>().combineAll,
        );

        return yield* $(
            GuessSet.empty,
            addGuesses,
            GuessSet.validate,
        );
    });

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
    // TODO run the deduction rule, and merge its findings
    //      keep re-running the deduction rule until it finds nothing new
    //      or exceeds some retry limit, at which point throw an Defect
    E.left(['Not implemented yet']);
