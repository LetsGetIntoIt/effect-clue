import * as T from '@effect/io/Effect';

import * as App from './Api';
import { Effect_expectSucceed, Effect_test } from '../utils/EffectTest';

describe('App', () => {
    test('scenario 1', async () => {
        await Effect_test(T.gen(function* ($) {
            const result = yield* $(Effect_expectSucceed(
                App.run({
                    cardSetup: [{
                        useStandard: 'North America',

                        extraCards: [
                            ['Room', 'Dog house'],
                        ],
                    }],

                    ownersSetup: [{
                        players: [
                            ['Kapil'],
                            ['Kate'],
                            ['Karthik'],
                        ],
                    
                        caseFiles: [
                            ['Murder'],
                        ],
                    }],

                    knownConclusionsSetup: [{
                        knownNumCards: [
                            [['Kapil'], 5],
                            [['Kate'], 10],
                        ],

                        knownCardOwners: [
                            [['Kapil'], ['Room', 'Dog house']],
                        ],
                    }],

                    guessesSetup: [{
                        guesses: [
                            {
                                cards: [
                                    ['Suspect', 'Col. Mustard'],
                                    ['Weapon', 'Knife'],
                                    ['Room', 'Dog house'],
                                ],
                                guesser: ['Kate'],
                                nonRefuters: [
                                    ['Karthik'],
                                ],
                                refutation: [
                                    ['Kate'],
                                    ['Weapon', 'Knife'],
                                ],
                            },

                            {
                                cards: [
                                    ['Suspect', 'Col. Mustard'],
                                    ['Weapon', 'Knife'],
                                    ['Room', 'Dog house'],
                                ],
                                guesser: ['Kate'],
                                nonRefuters: [
                                    // None
                                ],
                                refutation: [
                                    ['Kapil'],
                                    // Refute card unknown
                                ],
                            },
                        ],
                    }],

                    deductionRulesSetup: [[
                        'cardIsHeldExactlyOnce',
                    ]],
                }),
            ));

            // TODO actually write tests and assert stuff
            expect(result).toBeDefined();
        }));
    });
});
