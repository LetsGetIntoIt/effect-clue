import { HS, T } from "../utils/effect/EffectImports";
import { pipe } from "@effect/data/Function";
import { Effect_expectSucceed, Effect_test } from "../utils/effect/EffectTest";

import { Game } from '../game';

import * as Conclusion from './utils/Conclusion';
import * as DeductionRule from './DeductionRule';
import * as DeductionSet from "./DeductionSet";

import { MOCK_CARDS, MOCK_PLAYERS, mockDeductionsInGame } from "./DeductionRule.test-util";
import { CaseFile } from "../objects";

describe('DeductionRule', () => {
    describe('identity', () => {
        test('returns the original deductions', async () => {
            await Effect_test(T.gen(function* ($) {
                const game = Game.emptyStandard;

                const initialDeductions = DeductionSet.empty;
                const expectedDeductions = initialDeductions;

                const deductions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialDeductions,
                        DeductionRule.identity,

                        T.provideService(Game.Tag, game),
                    )));

                expect(deductions).toEqual(expectedDeductions);
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
                const game = yield* $(Effect_expectSucceed(
                    Game.Game({
                        cards: HS.fromIterable([MOCK_CARDS.mustard]),
                        players: HS.fromIterable([MOCK_PLAYERS.alice, MOCK_PLAYERS.bob]),
                        caseFile: CaseFile.standard,
                        guesses: HS.empty(),
                })));

                const initialDeductions = mockDeductionsInGame(game)({
                    ownership: [
                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, true, Conclusion.ReasonObserved('Manually entered')],
                    ],
                });

                const expectedDeductions = mockDeductionsInGame(game)({
                    ownership: [
                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, false, Conclusion.ReasonInferred('Card is already owned by someone else')],
                        [game.caseFile, MOCK_CARDS.mustard, false, Conclusion.ReasonInferred('Card is already owned by someone else')],
                    ],
                });

                const deductions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialDeductions,
                        DeductionRule.cardIsHeldAtMostOnce,

                        T.provideService(Game.Tag, game),
                    )));

                expect(deductions).toEqual(expectedDeductions);
            }));
        });

        test('card with a single known owner and non-owner', async () => {
            await Effect_test(T.gen(function* ($) {
                const game = yield* $(Effect_expectSucceed(
                    Game.Game({
                        cards: HS.fromIterable([MOCK_CARDS.mustard]),
                        players: HS.fromIterable([MOCK_PLAYERS.alice, MOCK_PLAYERS.bob]),
                        caseFile: CaseFile.standard,
                        guesses: HS.empty(),
                })));

                const initialDeductions = mockDeductionsInGame(game)({
                    ownership: [
                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Previously known')],
                    ],
                });

                const expectedDeductions = mockDeductionsInGame(game)({
                    ownership: [
                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Previously known')],
                        [game.caseFile, MOCK_CARDS.mustard, false, Conclusion.ReasonInferred('Card is already owned by someone else')],
                    ],
                });

                const deductions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialDeductions,
                        DeductionRule.cardIsHeldAtMostOnce,

                        T.provideService(Game.Tag, game),
                    )));

                expect(deductions).toEqual(expectedDeductions);
            }));
        });

        test('no cards with known owners', async () => {
            await Effect_test(T.gen(function* ($) {
                const game = yield* $(Effect_expectSucceed(
                    Game.Game({
                        cards: HS.fromIterable([MOCK_CARDS.mustard]),
                        players: HS.fromIterable([MOCK_PLAYERS.alice, MOCK_PLAYERS.bob]),
                        caseFile: CaseFile.standard,
                        guesses: HS.empty(),
                })));

                const initialDeductions = mockDeductionsInGame(game)({
                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Manually entered')],
                    ],
                });

                const expectedDeductions = initialDeductions;

                const deductions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialDeductions,
                        DeductionRule.cardIsHeldAtMostOnce,

                        T.provideService(Game.Tag, game),
                    )));

                expect(deductions).toEqual(expectedDeductions);
            }));
        });
    });

    describe('cardIsHeldAtLeastOnce', () => {
        test('card with N-1 known non-owners', async () => {
            await Effect_test(T.gen(function* ($) {
                const game = yield* $(Effect_expectSucceed(
                    Game.Game({
                        cards: HS.fromIterable([MOCK_CARDS.mustard]),
                        players: HS.fromIterable([MOCK_PLAYERS.alice, MOCK_PLAYERS.bob]),
                        caseFile: CaseFile.standard,
                        guesses: HS.empty(),
                })));

                const initialDeductions = mockDeductionsInGame(game)({
                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Manually entered')],
                    ],
                });

                const expectedDeductions = mockDeductionsInGame(game)({
                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Manually entered')],
                        [game.caseFile, MOCK_CARDS.mustard, true, Conclusion.ReasonInferred('Card not owned anywhere else')],
                    ],
                });

                const deductions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialDeductions,
                        DeductionRule.cardIsHeldAtLeastOnce,

                        T.provideService(Game.Tag, game),
                    )));

                expect(deductions).toEqual(expectedDeductions);
            }));
        });

        test('card with fewer than N-1 known non-owners', async () => {
            await Effect_test(T.gen(function* ($) {
                const game = yield* $(Effect_expectSucceed(
                    Game.Game({
                        cards: HS.fromIterable([MOCK_CARDS.mustard]),
                        players: HS.fromIterable([MOCK_PLAYERS.alice, MOCK_PLAYERS.bob]),
                        caseFile: CaseFile.standard,
                        guesses: HS.empty(),
                })));

                const initialDeductions = mockDeductionsInGame(game)({
                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Manually entered')],
                    ],
                });

                const expectedDeductions = mockDeductionsInGame(game)({
                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Manually entered')],
                    ],
                });

                const deductions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialDeductions,
                        DeductionRule.cardIsHeldAtLeastOnce,

                        T.provideService(Game.Tag, game),
                    )));

                expect(deductions).toEqual(expectedDeductions);
            }));
        });

        test('card with everything already known', async () => {
            await Effect_test(T.gen(function* ($) {
                const game = yield* $(Effect_expectSucceed(
                    Game.Game({
                        cards: HS.fromIterable([MOCK_CARDS.mustard]),
                        players: HS.fromIterable([MOCK_PLAYERS.alice, MOCK_PLAYERS.bob]),
                        caseFile: CaseFile.standard,
                        guesses: HS.empty(),
                })));

                const initialDeductions = mockDeductionsInGame(game)({
                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Manually entered')],
                        [game.caseFile, MOCK_CARDS.mustard, true, Conclusion.ReasonObserved('Previously known')],
                    ],
                });

                const expectedDeductions = mockDeductionsInGame(game)({
                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Manually entered')],
                        [game.caseFile, MOCK_CARDS.mustard, true, Conclusion.ReasonObserved('Previously known')],
                    ],
                });

                const deductions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialDeductions,
                        DeductionRule.cardIsHeldAtLeastOnce,

                        T.provideService(Game.Tag, game),
                    )));

                expect(deductions).toEqual(expectedDeductions);
            }));
        });
    });

    describe('playerHasNoMoreThanMaxNumCards', () => {
        test('we know all of the max cards of multiple players', async () => {
            await Effect_test(T.gen(function* ($) {
                const game = yield* $(Effect_expectSucceed(
                    Game.Game({
                        cards: HS.fromIterable([MOCK_CARDS.mustard, MOCK_CARDS.plum, MOCK_CARDS.wrench, MOCK_CARDS.knife, MOCK_CARDS.conservatory]),
                        players: HS.fromIterable([MOCK_PLAYERS.alice, MOCK_PLAYERS.bob]),
                        caseFile: CaseFile.standard,
                        guesses: HS.empty(),
                })));

                const initialDeductions = mockDeductionsInGame(game)({
                    numCards: [
                        [MOCK_PLAYERS.alice, [2], Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, [1, 2], Conclusion.ReasonObserved('Manually entered')],
                    ],

                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.plum, true, Conclusion.ReasonObserved('Manually entered')],
                        
                        [MOCK_PLAYERS.bob, MOCK_CARDS.wrench, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.knife, true, Conclusion.ReasonObserved('Manually entered')],
                    ],
                });

                const expectedDeductions = mockDeductionsInGame(game)({
                    numCards: [
                        [MOCK_PLAYERS.alice, [2], Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, [1, 2], Conclusion.ReasonObserved('Manually entered')],
                    ],

                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.plum, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.wrench, false, Conclusion.ReasonInferred(`All of this player's cards have been accounted for already, so they cannot own this one`)],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.knife, false, Conclusion.ReasonInferred(`All of this player's cards have been accounted for already, so they cannot own this one`)],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.conservatory, false, Conclusion.ReasonInferred(`All of this player's cards have been accounted for already, so they cannot own this one`)],

                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, false, Conclusion.ReasonInferred(`All of this player's cards have been accounted for already, so they cannot own this one`)],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.plum, false, Conclusion.ReasonInferred(`All of this player's cards have been accounted for already, so they cannot own this one`)],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.wrench, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.knife, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.conservatory, false, Conclusion.ReasonInferred(`All of this player's cards have been accounted for already, so they cannot own this one`)],
                    ],
                });

                const deductions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialDeductions,
                        DeductionRule.playerHasNoMoreThanMaxNumCards,

                        T.provideService(Game.Tag, game),
                    )));

                expect(deductions).toEqual(expectedDeductions);
            }));
        });

        test('we know a mix of cards from some players', async () => {
            await Effect_test(T.gen(function* ($) {
                const game = yield* $(Effect_expectSucceed(
                    Game.Game({
                        cards: HS.fromIterable([MOCK_CARDS.mustard, MOCK_CARDS.plum, MOCK_CARDS.wrench, MOCK_CARDS.knife, MOCK_CARDS.conservatory]),
                        players: HS.fromIterable([MOCK_PLAYERS.alice, MOCK_PLAYERS.bob]),
                        caseFile: CaseFile.standard,
                        guesses: HS.empty(),
                })));

                const initialDeductions = mockDeductionsInGame(game)({
                    numCards: [
                        [MOCK_PLAYERS.alice, [2], Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, [1, 2], Conclusion.ReasonObserved('Manually entered')],
                    ],

                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.plum, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.wrench, false, Conclusion.ReasonObserved('Previously known')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.knife, false, Conclusion.ReasonObserved('Previously known')],

                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Previously known')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.plum, false, Conclusion.ReasonObserved('Previously known')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.wrench, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.knife, true, Conclusion.ReasonObserved('Manually entered')],
                    ],
                });

                const expectedDeductions = mockDeductionsInGame(game)({
                    numCards: [
                        [MOCK_PLAYERS.alice, [2], Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, [1, 2], Conclusion.ReasonObserved('Manually entered')],
                    ],

                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.plum, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.wrench, false, Conclusion.ReasonObserved('Previously known')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.knife, false, Conclusion.ReasonObserved('Previously known')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.conservatory, false, Conclusion.ReasonInferred(`All of this player's cards have been accounted for already, so they cannot own this one`)],

                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Previously known')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.plum, false, Conclusion.ReasonObserved('Previously known')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.wrench, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.knife, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.conservatory, false, Conclusion.ReasonInferred(`All of this player's cards have been accounted for already, so they cannot own this one`)],
                    ],
                });

                const deductions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialDeductions,
                        DeductionRule.playerHasNoMoreThanMaxNumCards,

                        T.provideService(Game.Tag, game),
                    )));

                expect(deductions).toEqual(expectedDeductions);
            }));
        });

        test('we know many cards of a player, but not how many they have', async () => {
            await Effect_test(T.gen(function* ($) {
                const game = yield* $(Effect_expectSucceed(
                    Game.Game({
                        cards: HS.fromIterable([MOCK_CARDS.mustard, MOCK_CARDS.plum, MOCK_CARDS.wrench, MOCK_CARDS.knife, MOCK_CARDS.conservatory]),
                        players: HS.fromIterable([MOCK_PLAYERS.alice, MOCK_PLAYERS.bob]),
                        caseFile: CaseFile.standard,
                        guesses: HS.empty(),
                })));

                const initialDeductions = mockDeductionsInGame(game)({
                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.plum, true, Conclusion.ReasonObserved('Manually entered')],
                        
                        [MOCK_PLAYERS.bob, MOCK_CARDS.wrench, true, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.knife, true, Conclusion.ReasonObserved('Manually entered')],
                    ],
                });

                const expectedDeductions = initialDeductions;

                const deductions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialDeductions,
                        DeductionRule.playerHasNoMoreThanMaxNumCards,

                        T.provideService(Game.Tag, game),
                    )));

                expect(deductions).toEqual(expectedDeductions);
            }));
        });
    });

    describe('playerHasNoLessThanMinNumCards', () => {
        test('we know all except the min cards of multiple players', async () => {
            await Effect_test(T.gen(function* ($) {
                const game = yield* $(Effect_expectSucceed(
                    Game.Game({
                        cards: HS.fromIterable([MOCK_CARDS.mustard, MOCK_CARDS.plum, MOCK_CARDS.wrench, MOCK_CARDS.knife, MOCK_CARDS.conservatory]),
                        players: HS.fromIterable([MOCK_PLAYERS.alice, MOCK_PLAYERS.bob]),
                        caseFile: CaseFile.standard,
                        guesses: HS.empty(),
                })));

                const initialDeductions = mockDeductionsInGame(game)({
                    numCards: [
                        [MOCK_PLAYERS.alice, [2], Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, [2, 3], Conclusion.ReasonObserved('Manually entered')],
                    ],

                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.wrench, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.knife, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.conservatory, false, Conclusion.ReasonObserved('Manually entered')],

                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.plum, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.conservatory, false, Conclusion.ReasonObserved('Manually entered')],
                    ],
                });

                const expectedDeductions = mockDeductionsInGame(game)({
                    numCards: [
                        [MOCK_PLAYERS.alice, [2], Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, [2, 3], Conclusion.ReasonObserved('Manually entered')],
                    ],

                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, true, Conclusion.ReasonInferred(`All except this player's min number of cards have been accounted for, so they definitely own the rest`)],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.plum, true, Conclusion.ReasonInferred(`All except this player's min number of cards have been accounted for, so they definitely own the rest`)],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.wrench, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.knife, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.conservatory, false, Conclusion.ReasonObserved('Manually entered')],

                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.plum, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.wrench, true, Conclusion.ReasonInferred(`All except this player's min number of cards have been accounted for, so they definitely own the rest`)],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.knife, true, Conclusion.ReasonInferred(`All except this player's min number of cards have been accounted for, so they definitely own the rest`)],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.conservatory, false,Conclusion.ReasonObserved('Manually entered')],
                    ],
                });

                const deductions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialDeductions,
                        DeductionRule.playerHasNoLessThanMinNumCards,

                        T.provideService(Game.Tag, game),
                    )));

                expect(deductions).toEqual(expectedDeductions);
            }));
        });

        test('we know a mix of cards from some players', async () => {
            await Effect_test(T.gen(function* ($) {
                const game = yield* $(Effect_expectSucceed(
                    Game.Game({
                        cards: HS.fromIterable([MOCK_CARDS.mustard, MOCK_CARDS.plum, MOCK_CARDS.wrench, MOCK_CARDS.knife, MOCK_CARDS.conservatory]),
                        players: HS.fromIterable([MOCK_PLAYERS.alice, MOCK_PLAYERS.bob]),
                        caseFile: CaseFile.standard,
                        guesses: HS.empty(),
                })));

                const initialDeductions = mockDeductionsInGame(game)({
                    numCards: [
                        [MOCK_PLAYERS.alice, [2], Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, [2, 3], Conclusion.ReasonObserved('Manually entered')],
                    ],

                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, true, Conclusion.ReasonObserved('Previously known')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.wrench, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.knife, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.conservatory, false, Conclusion.ReasonObserved('Manually entered')],

                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.plum, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.wrench, true, Conclusion.ReasonObserved('Previously known')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.conservatory, false, Conclusion.ReasonObserved('Manually entered')],
                    ],
                });

                const expectedDeductions = mockDeductionsInGame(game)({
                    numCards: [
                        [MOCK_PLAYERS.alice, [2], Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, [2, 3], Conclusion.ReasonObserved('Manually entered')],
                    ],

                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.mustard, true, Conclusion.ReasonObserved('Previously known')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.plum, true, Conclusion.ReasonInferred(`All except this player's min number of cards have been accounted for, so they definitely own the rest`)],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.wrench, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.knife, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.conservatory, false, Conclusion.ReasonObserved('Manually entered')],

                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.plum, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.wrench, true, Conclusion.ReasonObserved('Previously known')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.knife, true, Conclusion.ReasonInferred(`All except this player's min number of cards have been accounted for, so they definitely own the rest`)],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.conservatory, false,Conclusion.ReasonObserved('Manually entered')],
                    ],
                });

                const deductions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialDeductions,
                        DeductionRule.playerHasNoLessThanMinNumCards,

                        T.provideService(Game.Tag, game),
                    )));

                expect(deductions).toEqual(expectedDeductions);
            }));
        });

        test('we know many non-cards of a player, but not how many they have', async () => {
            await Effect_test(T.gen(function* ($) {
                const game = yield* $(Effect_expectSucceed(
                    Game.Game({
                        cards: HS.fromIterable([MOCK_CARDS.mustard, MOCK_CARDS.plum, MOCK_CARDS.wrench, MOCK_CARDS.knife, MOCK_CARDS.conservatory]),
                        players: HS.fromIterable([MOCK_PLAYERS.alice, MOCK_PLAYERS.bob]),
                        caseFile: CaseFile.standard,
                        guesses: HS.empty(),
                })));

                const initialDeductions = mockDeductionsInGame(game)({
                    ownership: [
                        [MOCK_PLAYERS.alice, MOCK_CARDS.wrench, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.knife, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.alice, MOCK_CARDS.conservatory, false, Conclusion.ReasonObserved('Manually entered')],

                        [MOCK_PLAYERS.bob, MOCK_CARDS.mustard, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.plum, false, Conclusion.ReasonObserved('Manually entered')],
                        [MOCK_PLAYERS.bob, MOCK_CARDS.conservatory, false, Conclusion.ReasonObserved('Manually entered')],
                    ],
                });

                const expectedDeductions = initialDeductions;

                const deductions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialDeductions,
                        DeductionRule.playerHasNoLessThanMinNumCards,

                        T.provideService(Game.Tag, game),
                    )));

                expect(deductions).toEqual(expectedDeductions);
            }));
        });
    });

    describe('caseFileHasAtMostOnePerCardType', () => {
        test.todo('test this function');
    });

    describe('caseFileHasAtLeastOnePerCardType', () => {
        test.todo('test this function');
    });

    describe('guessIsRefutedByHeldCard', () => {
        test.todo('test this function');
    });

    describe('playerWith1CardRefutesWithIntersection', () => {
        test.todo('test this function');
    });
});