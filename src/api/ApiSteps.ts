
import { E, B, ROA, O, EQ, P, M, S, PR, T, HS } from './utils/effect/EffectImports';
import { pipe } from '@effect/data/Function';

import { Card, Player, CaseFile, Guess } from './objects';
import { Game } from './game';
import { DeductionRule, DeductionSet } from './logic';

const parseObject = <I, O>(
    schema: S.Schema<I, O>,
) => (
    thing: I,
): T.Effect<never, PR.ParseError, O> =>
    S.parse(schema)(thing, { errors: 'all' })

const parseObjects = <I, O>(
    schema: S.Schema<I, O>,
) => (
    things: readonly I[],
): T.Effect<never, (PR.ParseError | null)[], HS.HashSet<O>> =>
    pipe(
        things,

        // Validate all cards
        ROA.map(parseObject(schema)),
        _ => T.allValidate(_, { concurrency: 'unbounded' }),

        // Format the errors and return value
        T.mapBoth({
            onFailure: ROA.map(O.getOrNull),
            onSuccess: HS.fromIterable,
        }),
    );

export const parseCards: (
    cards: readonly Card.Serialized[],
) => T.Effect<never, (PR.ParseError | null)[], HS.HashSet<Card.Card>> =
    parseObjects(Card.Schema);

export const parsePlayers: (
    players: readonly Player.Serialized[],
) => T.Effect<never, (PR.ParseError | null)[], HS.HashSet<Player.Player>> =
    parseObjects(Player.Schema);

export const parseCaseFile: (
    caseFile: CaseFile.Serialized,
) => T.Effect<never, PR.ParseError, CaseFile.CaseFile> =
    parseObject(CaseFile.Schema);

export const parseGuesses: (
    guesses: readonly Guess.Serialized[],
) => T.Effect<never, (PR.ParseError | null)[], HS.HashSet<Guess.Guess>> =
    parseObjects(Guess.Schema);

export const createGame = ({
    cards = HS.empty(),
    players = HS.empty(),
    caseFile = CaseFile.standard,
    guesses = HS.empty(),
}: {
    cards?: HS.HashSet<Card.Card>;
    players?: HS.HashSet<Player.Player>;
    caseFile?: CaseFile.CaseFile;
    guesses?: HS.HashSet<Guess.Guess>;
}): T.Effect<never, PR.ParseErrors, Game.Game> =>
    Game.Game({
        cards,
        players,
        caseFile,
        guesses,
    });

export const provideGame = (game: Game.Game) =>
    T.provideService(Game.Tag, game);

export const parseKnownDeductions = ({
    knownNumCards: rawKnownNumCards = [],
    knownCardOwners: rawKnownCardOwners = [],
}: {
    knownNumCards?: readonly [Player.Serialized, number][];
    knownCardOwners?: readonly [Player.Serialized, Card.Serialized, boolean][];
}): T.Effect<Game.Game, B.Brand.BrandErrors, DeductionSet.ValidatedDeductionSet> =>
    T.gen(function* ($) {
        const knownNumCards = yield* $(parseObjects(
            S.data(S.tuple(Player.Schema, S.number)),
        )(
            rawKnownNumCards,
        ));

        const knownCardOwners = yield* $(parseObjects(
            S.data(S.tuple(Player.Schema, Card.Schema, S.boolean)),
        )(
            rawKnownCardOwners,
        ));

        const addknownNumCardDeductions = HS.map(knownNumCards, ([player, numCards]) =>
            DeductionSet.modifyAddNumCards(
                player,
                [numCards],
                Conclusion.Reason({
                    level: 'observed',
                    explanation: 'Manually entered',
                })
            ),
        );

        const addKnownCardOwnerDeductions = HS.map(knownCardOwners, ([player, card, isOwned]) =>
            DeductionSet.modifyAddOwnership(
                CardOwner.CardOwnerPlayer({ player }),
                card,
                isOwned,
                Conclusion.Reason({
                    level: 'observed',
                    explanation: 'Manually entered',
                })
            ),
        );

        const addDeductions = DeductionRule.MonoidUnion.combineAll([
            ...HS.values(addknownNumCardDeductions),
            ...HS.values(addknownNumCardDeductions),
        ]);

        return yield* $(
            DeductionSet.empty,
            addDeductions
        );
    });

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
            M.when('playerHasNarrowestNumCardRange', () => DeductionRule.playerHasNarrowestNumCardRange),
            M.when('playerHasMinNumCardsRefuted', () => DeductionRule.playerHasMinNumCardsRefuted),
            M.when('cardIsHeldAtMostOnce', () => DeductionRule.cardIsHeldAtMostOnce),
            M.when('cardIsHeldAtLeastOnce', () => DeductionRule.cardIsHeldAtLeastOnce),
            M.when('playerHasNoMoreThanMaxNumCards', () => DeductionRule.playerHasNoMoreThanMaxNumCards),
            M.when('playerHasNoLessThanMinNumCards', () => DeductionRule.playerHasNoLessThanMinNumCards),
            M.when('caseFileHasAtMostOnePerCardType', () => DeductionRule.caseFileHasAtMostOnePerCardType),
            M.when('caseFileHasAtLeastOnePerCardType', () => DeductionRule.caseFileHasAtLeastOnePerCardType),
            M.when('guessIsRefutedByHeldCard', () => DeductionRule.guessIsRefutedByHeldCard),
            M.when('playerWith1CardRefutesWithIntersection', () => DeductionRule.playerWith1CardRefutesWithIntersection),

            M.exhaustive,
        )),

        // Combine them all into a single deduction rule
        DeductionRule.MonoidUnion.combineAll,

        // This operation is always successful
        E.right,
    );

export const deduce = (
    deductionRule: DeductionRule.DeductionRule,
    {
        maxIterations,
    }: {
        maxIterations?: number,
    } = {
        // Default to no options
    }
) => (
    initialDeductions: DeductionSet.ValidatedDeductionSet,
): T.Effect<
    Game.Game | GuessSet.ValidatedGuessSet,
    B.Brand.BrandErrors,
    DeductionSet.ValidatedDeductionSet
> =>
    T.gen(function* ($) {
        // Start with the initial deductions
        let previousDeductions;
        let newDeductions = initialDeductions;
        let iterationNum = 0;

        do {
            iterationNum++;

            // Add more deductions recursively, tracking the results of the previous iteration
            previousDeductions = newDeductions;
            newDeductions = yield* $(deductionRule(newDeductions));
        } while (
            // Continue as long as the iteration gave us new results
            !EQ.equals(previousDeductions, newDeductions)

            // Continue forever if no max iterations is provided,
            // or continue as long as we haven't hit that maximum
            && (P.isNullable(maxIterations) || iterationNum < maxIterations)
        );

        return newDeductions;
    });
