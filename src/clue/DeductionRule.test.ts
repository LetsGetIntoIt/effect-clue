import { pipe } from "@effect/data/Function";
import { E, EQ, HS, T } from "../utils/EffectImports";
import { Effect_expectSucceed, Effect_test } from "../utils/EffectTest";

import * as DeductionRule from './DeductionRule';
import * as ConclusionMapSet from "./ConclusionMapSet";
import * as Player from "./Player";
import * as Conclusion from "./Conclusion";
import * as Game from "./Game";
import * as GuessSet from "./GuessSet";
import * as CaseFile from "./CaseFile";
import { mockValue } from "../utils/JestTest";

describe('DeductionRule', () => {
    describe('identity', () => {
        test('returns the original conclusions', async () => {
            await Effect_test(T.gen(function* ($) {
                const game = mockValue<Game.Game>('game');
                const guesses = mockValue<GuessSet.ValidatedGuessSet>('guesses');
                const initialConclusions = mockValue<ConclusionMapSet.ValidatedConclusionMapSet>('initialConclusions');

                const deducedConclusions =
                    yield* $(Effect_expectSucceed(pipe(
                        initialConclusions,
                        DeductionRule.identity,

                        T.provideService(Game.Tag, game),
                        T.provideService(GuessSet.Tag, guesses),
                    )));

                expect(EQ.equals(deducedConclusions, initialConclusions)).toEqual(true);
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
        test.todo('test this function');
    });

    describe('cardIsHeldAtLeastOnce', () => {
        test.todo('test this function');
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