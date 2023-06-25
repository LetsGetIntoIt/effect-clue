import { pipe } from "@effect/data/Function";
import { T } from "../utils/EffectImports";
import { Effect_expectSucceed, Effect_test } from "../utils/EffectTest";

import * as DeductionRule from './DeductionRule';
import * as ConclusionMapSet from "./ConclusionMapSet";
import * as Game from "./Game";
import * as GuessSet from "./GuessSet";
import { MOCK_CARDS, MOCK_PLAYERS, mockConclusionsInGame, mockGame, mockReasonInferred, mockReasonObserved } from "./DeductionRule.test-util";

describe('DeductionRule', () => {
    describe('identity', () => {
        test('returns the original conclusions', async () => {
            await Effect_test(T.gen(function* ($) {
                const game = Game.emptyStandard;
                const guesses = GuessSet.empty;

                const initialConclusions = ConclusionMapSet.empty;
                const expectedConclusions = initialConclusions;

                const deducedConclusions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialConclusions,
                        DeductionRule.identity,

                        T.provideService(Game.Tag, game),
                        T.provideService(GuessSet.Tag, guesses),
                    )));

                expect(deducedConclusions).toEqual(expectedConclusions);
            }));
        });
    });

    describe('SemigroupUnion', () => {
        test.todo('test this function');
    });

    describe('MonoidUnion', () => {
        test.todo('test this function');
    });

    describe('playerHasZeroToNumAllCards', () => {
        test.todo('test this function');
    });

    describe('playerHasMaxNumCardsRemaining', () => {
        test.todo('test this function');
    });

    describe('playerHasMinNumCardsRefuted', () => {
        test.todo('test this function');
    });

    describe('cardIsHeldAtMostOnce', () => {
        test('card with a single known owner', async () => {
            await Effect_test(T.gen(function* ($) {
                const game = mockGame({
                    cards: [MOCK_CARDS.mustard],
                    players: [MOCK_PLAYERS.alice, MOCK_PLAYERS.bob],
                });

                const guesses = GuessSet.empty;

                const initialConclusions = mockConclusionsInGame(game, guesses)({
                    ownership: [
                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, true, mockReasonObserved('Manually entered')],
                    ],
                });

                const expectedConclusions = mockConclusionsInGame(game, guesses)({
                    ownership: [
                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, true, mockReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, false, mockReasonInferred('Card is already owned by someone else')],
                        [game.caseFile, MOCK_CARDS.mustard, false, mockReasonInferred('Card is already owned by someone else')],
                    ],
                });

                const deducedConclusions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialConclusions,
                        DeductionRule.cardIsHeldAtMostOnce,

                        T.provideService(Game.Tag, game),
                        T.provideService(GuessSet.Tag, guesses),
                    )));

                expect(deducedConclusions).toEqual(expectedConclusions);
            }));
        });

        test('card with a single known owner and non-owner', async () => {
            await Effect_test(T.gen(function* ($) {
                const game = mockGame({
                    cards: [MOCK_CARDS.mustard],
                    players: [MOCK_PLAYERS.alice, MOCK_PLAYERS.bob],
                });

                const guesses = GuessSet.empty;

                const initialConclusions = mockConclusionsInGame(game, guesses)({
                    ownership: [
                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, true, mockReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, false, mockReasonObserved('Previously known')],
                    ],
                });

                const expectedConclusions = mockConclusionsInGame(game, guesses)({
                    ownership: [
                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, true, mockReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, false, mockReasonObserved('Previously known')],
                        [game.caseFile, MOCK_CARDS.mustard, false, mockReasonInferred('Card is already owned by someone else')],
                    ],
                });

                const deducedConclusions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialConclusions,
                        DeductionRule.cardIsHeldAtMostOnce,

                        T.provideService(Game.Tag, game),
                        T.provideService(GuessSet.Tag, guesses),
                    )));

                expect(deducedConclusions).toEqual(expectedConclusions);
            }));
        });

        test('no cards with known owners', async () => {
            await Effect_test(T.gen(function* ($) {
                const game = mockGame({
                    cards: [MOCK_CARDS.mustard],
                    players: [MOCK_PLAYERS.alice, MOCK_PLAYERS.bob],
                });

                const guesses = GuessSet.empty;

                const initialConclusions = mockConclusionsInGame(game, guesses)({
                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, false, mockReasonObserved('Manually entered')],
                    ],
                });

                const expectedConclusions = initialConclusions;

                const deducedConclusions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialConclusions,
                        DeductionRule.cardIsHeldAtMostOnce,

                        T.provideService(Game.Tag, game),
                        T.provideService(GuessSet.Tag, guesses),
                    )));

                expect(deducedConclusions).toEqual(expectedConclusions);
            }));
        });
    });

    describe('cardIsHeldAtLeastOnce', () => {
        test('card with N-1 known non-owners', () => {

        });

        test('card with only a couple known non-owners', () => {

        });

        test('card with everything already known', () => {

        });
    });

    describe('cardIsHeldExactlyOnce', () => {
        test.todo('test this function');
    });

    describe('playerHasNoMoreThanMaxNumCards', () => {
        test.todo('test this function');
    });

    describe('playerHasNoLessThanMinNumCards', () => {
        test.todo('test this function');
    });

    describe('playerHasNoCardsOutsideNumCardsRage', () => {
        test.todo('test this function');
    });

    describe('caseFileHasAtMostOnePerCardType', () => {
        test.todo('test this function');
    });

    describe('caseFileHasAtLeastOnePerCardType', () => {
        test.todo('test this function');
    });

    describe('caseFileHasExactlyOnePerCardType', () => {
        test.todo('test this function');
    });

    describe('guessIsRefutedByHeldCard', () => {
        test.todo('test this function');
    });

    describe('playerWith1CardRefutesWithIntersection', () => {
        test.todo('test this function');
    });
});