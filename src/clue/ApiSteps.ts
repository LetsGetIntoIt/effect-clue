
import { E, B, ROA, T, HS, O, ST, EQ, P, M } from '../utils/EffectImports';
import { flow, pipe } from '@effect/data/Function';
import { Endomorphism_getMonoid } from '../utils/ShouldBeBuiltin';

import * as Card from './Card';
import * as CardSet from './CardSet';
import * as Player from './Player';
import * as CaseFile from './CaseFile';
import * as PlayerSet from './PlayerSet';
import * as CardOwner from './CardOwner';
import * as Game from './Game';
import * as Guess from './Guess';
import * as GuessSet from './GuessSet';
import * as DeductionRule from './DeductionRule';
import * as Conclusion from './Conclusion';
import * as ConclusionMapSet from './ConclusionMapSet';


type RawCard = [string, string];

const parseCard: (card: RawCard) => E.Either<B.Brand.BrandErrors, Card.ValidatedCard> =
    flow(
        ([cardType, label]) => Card.Card({
            cardType,
            label,
        }),

        Card.ValidatedCard,
    );

export const setupCards = ({
    useStandard,
    extraCards: rawExtraCards = [],
}: {
    useStandard?: 'North America';
    extraCards?: RawCard[];
}): E.Either<B.Brand.BrandErrors, CardSet.ValidatedCardSet> =>
    E.gen(function* ($) {
        // Start with whatever standard set was selected
        const startingSet = pipe(
            M.value(useStandard),

            // If no standard set is selected, leave the set untouched
            M.when(undefined, () => CardSet.empty),
            
            // Otherwise, add the selected standard set
            M.when('North America', () => CardSet.northAmerica),

            M.exhaustive,
        );

        // Create the extra manual cards
        const extraCards = yield* $(
            E.validateAll(rawExtraCards, parseCard), 
            E.mapLeft(errors => B.errors(...errors)),
        );

        // Create our function to add all these extra cards
        const addExtraCards = pipe(
            extraCards,
            ROA.map(CardSet.add),
            Endomorphism_getMonoid<CardSet.CardSet>().combineAll,
        );

        return yield* $(
            startingSet,
            addExtraCards,
            CardSet.ValidatedCardSet,
        );
    });

type RawPlayer = [string];
type RawCaseFile = [string];

const parsePlayer: (player: RawPlayer) => E.Either<B.Brand.BrandErrors, Player.ValidatedPlayer> =
    flow(
        ([name]) => Player.Player({ name }),
        Player.ValidatedPlayer,
    );

const parseCaseFile: (caseFile: RawCaseFile) => E.Either<B.Brand.BrandErrors, CaseFile.ValidatedCaseFile> =
    flow(
        ([label]) => CaseFile.CaseFile({ label }),
        CaseFile.ValidatedCaseFile,
    );

export const setupPlayers = ({
    players: rawPlayers = [],
}: {
    players?: RawPlayer[];
}): E.Either<B.Brand.BrandErrors, PlayerSet.ValidatedPlayerSet> =>
    E.gen(function* ($) {
        const players = yield* $(
            E.validateAll(rawPlayers, parsePlayer),
            E.mapLeft(errors => B.errors(...errors)),
        );

        // Create our functiont to add all these owners
        const addAllOwners = pipe(
            players,
            ROA.map(PlayerSet.add),
            Endomorphism_getMonoid<PlayerSet.PlayerSet>().combineAll,
        );

        return yield* $(
            PlayerSet.empty,
            addAllOwners,
            PlayerSet.ValidatedPlayerSet,
        );
    });

export const setupCaseFile = ({
    caseFile: rawCaseFile = ['Murder'],
}: {
    caseFile?: RawCaseFile;
}): E.Either<B.Brand.BrandErrors, CaseFile.ValidatedCaseFile> =>
    E.gen(function* ($) {
        return yield* $(parseCaseFile(rawCaseFile));
    });

export const setupGame = ({
    cards = CardSet.empty,
    players = PlayerSet.empty,
    caseFile = CaseFile.standard,
}: {
    cards?: CardSet.ValidatedCardSet;
    players?: PlayerSet.ValidatedPlayerSet;
    caseFile?: CaseFile.ValidatedCaseFile;
}): E.Either<B.Brand.BrandErrors, Game.Game> =>
    E.right(Game.Game({
        cards,
        players,
        caseFile,
    }));

export const provideGame = (game: Game.Game) =>
    T.provideService(Game.Tag, game);

export const setupKnownConclusions = ({
    knownNumCards: rawKnownNumCards = [],
    knownCardOwners: rawKnownCardOwners = [],
}: {
    knownNumCards?: readonly [RawPlayer, number][];
    knownCardOwners?: readonly [RawPlayer, RawCard][];
}): T.Effect<Game.Game, B.Brand.BrandErrors, ConclusionMapSet.ValidatedConclusionMapSet> =>
    T.gen(function* ($) {
        const knownNumCards = yield* $(
            E.validateAll(
                rawKnownNumCards,

                ([player, numCards]) => E.tuple(
                    parsePlayer(player),
                    E.right(numCards),
                ),
            ),

            // Concat all the errors
            E.mapLeft(errors => B.errors(...errors)),
        );

        const knownCardOwners = yield* $(
            E.validateAll(
                rawKnownCardOwners,

                ([player, card]) => E.tuple(
                    parsePlayer(player),
                    parseCard(card),
                ),
            ),

            // Concat all the errors
            E.mapLeft(errors => B.errors(...errors)),
        );

        // Create the function to add all these conclusions
        const addConclusions = pipe(
            ROA.map(knownNumCards, ([player, numCards]) =>
                ConclusionMapSet.modifyAddNumCardsExact(
                    player,
                    numCards,
                    Conclusion.Reason({
                        level: 'observed',
                        explanation: 'Manually entered',
                    })
                ),
            ),

            ROA.appendAll(ROA.map(knownCardOwners, ([player, card]) =>
                ConclusionMapSet.modifyAddOwnership(
                    CardOwner.CardOwnerPlayer({ player }),
                    card,
                    true,
                    Conclusion.Reason({
                        level: 'observed',
                        explanation: 'Manually entered',
                    })
                ),
            )),

            ConclusionMapSet.ModificationMonoid.combineAll,
        );

        return yield* $(
            ConclusionMapSet.empty,
            addConclusions,
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
const parseGuess = ({
    cards: rawCards,
    guesser: rawGuesser,
    nonRefuters: rawNonRefuters,
    refutation: rawRefutation,
}: RawGuess): T.Effect<Game.Game, B.Brand.BrandErrors, Guess.ValidatedGuess> =>
    T.gen(function* ($) {
        const cards = yield* $(
            E.validateAll(rawCards, parseCard),
            E.mapLeft(errors => B.errors(...errors)),
            E.map(HS.fromIterable),
        );

        const guesser = yield* $(parsePlayer(rawGuesser));

        const nonRefuters = yield* $(
            E.validateAll(rawNonRefuters, parsePlayer),
            E.mapLeft(errors => B.errors(...errors)),
            E.map(HS.fromIterable),
        );

        const refutation = yield* $(
            O.fromNullable(rawRefutation),

            O.map(flow(
                ([rawPlayer, rawCard]) => ({
                    refuter: rawPlayer,
                    card: rawCard,
                }),

                ST.evolve({
                    refuter: parsePlayer,
                    
                    card: flow(
                        O.fromNullable,
                        O.map(parseCard),
                        O.sequence(E.Applicative),
                    ),
                }),

                E.struct,
            )),

            O.sequence(E.Applicative),
        );

        return yield* $(
            Guess.Guess({
                cards,
                guesser,
                nonRefuters,
                refutation,
            }),

            Guess.ValidatedGuess,
        );
    });

export const setupGuesses = ({
    guesses: rawGuesses = [],
}: {
    guesses?: RawGuess[];
}): T.Effect<Game.Game, B.Brand.BrandErrors, GuessSet.ValidatedGuessSet> =>
    T.gen(function* ($) {
        // Create the guesses
        const guesses = yield* $(
            T.validateAll(rawGuesses, parseGuess),
            T.mapError(errors => B.errors(...errors)),
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
            GuessSet.ValidatedGuessSet,
        );
    });

export const provideGuesses = (guesses: GuessSet.ValidatedGuessSet) =>
    T.provideService(GuessSet.Tag, guesses);

const ALL_DEDUCTION_RULES = [
    'playerHasAtLeastZeroCards',
    'playerHasMaxNumCardsRemaining',
    'playerHasMinNumCardsRefuted',
    'cardIsHeldAtMostOnce',
    'cardIsHeldAtLeastOnce',
    'cardIsHeldExactlyOnce',
    'playerHasNoMoreThanMaxNumCards',
    'playerHasNoLessThanMinNumCards',
    'playerHasNoCardsOutsideNumCardsRage',
    'caseFileHasAtMostOnePerCardType',
    'caseFileHasAtLeastOnePerCardType',
    'caseFileHasExactlyOnePerCardType',
    'guessIsRefutedByHeldCard',
    'playerWith1CardRefutesWithIntersection',
] as const;

type RawDeductionRule = typeof ALL_DEDUCTION_RULES[number];

export const setupDeductionRules = (
    rules: 'all' | readonly RawDeductionRule[] = 'all',
): E.Either<B.Brand.BrandErrors, DeductionRule.DeductionRule> =>
    pipe(
        // Convert the default list of "all"
        rules,
        rules => typeof rules === 'string'
            ? ALL_DEDUCTION_RULES
            : rules,

        // TODO validate that the strings are actually valid

        // Convert the selected deduction rule IDs to actual functions
        ROA.map(pipe(
            M.type<RawDeductionRule>(),

            M.when('playerHasAtLeastZeroCards', () => DeductionRule.playerHasZeroToNumAllCards),
            M.when('playerHasMaxNumCardsRemaining', () => DeductionRule.playerHasMaxNumCardsRemaining),
            M.when('playerHasMinNumCardsRefuted', () => DeductionRule.playerHasMinNumCardsRefuted),
            M.when('cardIsHeldAtMostOnce', () => DeductionRule.cardIsHeldAtMostOnce),
            M.when('cardIsHeldAtLeastOnce', () => DeductionRule.cardIsHeldAtLeastOnce),
            M.when('cardIsHeldExactlyOnce', () => DeductionRule.cardIsHeldExactlyOnce),
            M.when('playerHasNoMoreThanMaxNumCards', () => DeductionRule.playerHasNoMoreThanMaxNumCards),
            M.when('playerHasNoLessThanMinNumCards', () => DeductionRule.playerHasNoLessThanMinNumCards),
            M.when('playerHasNoCardsOutsideNumCardsRage', () => DeductionRule.playerHasNoCardsOutsideNumCardsRage),
            M.when('caseFileHasAtMostOnePerCardType', () => DeductionRule.caseFileHasAtMostOnePerCardType),
            M.when('caseFileHasAtLeastOnePerCardType', () => DeductionRule.caseFileHasAtLeastOnePerCardType),
            M.when('caseFileHasExactlyOnePerCardType', () => DeductionRule.caseFileHasExactlyOnePerCardType),
            M.when('guessIsRefutedByHeldCard', () => DeductionRule.guessIsRefutedByHeldCard),
            M.when('playerWith1CardRefutesWithIntersection', () => DeductionRule.playerWith1CardRefutesWithIntersection),

            M.exhaustive,
        )),

        // Combine them all into a single deduction rule
        DeductionRule.MonoidUnion.combineAll,

        // This operation is always successful
        E.right,
    );

export const deduceConclusions = (
    deductionRule: DeductionRule.DeductionRule,
    {
        maxIterations,
    }: {
        maxIterations?: number,
    } = {
        // Default to no options
    }
) => (
    initialConclusions: ConclusionMapSet.ValidatedConclusionMapSet,
): T.Effect<
    Game.Game | GuessSet.ValidatedGuessSet,
    B.Brand.BrandErrors,
    ConclusionMapSet.ValidatedConclusionMapSet
> =>
    T.gen(function* ($) {
        // Start with the initial conclusions
        let previousConclusions;
        let newConclusions = initialConclusions;
        let iterationNum = 0;

        do {
            iterationNum++;

            // Add more conclusions recursively, tracking the results of the previous iteration
            previousConclusions = newConclusions;
            newConclusions = yield* $(deductionRule(newConclusions));
        } while (
            // Continue as long as the iteration gave us new results
            !EQ.equals(previousConclusions, newConclusions)

            // Continue forever if no max iterations is provided,
            // or continue as long as we haven't hit that maximum
            && (P.isNullable(maxIterations) || iterationNum < maxIterations)
        );

        return newConclusions;
    });
