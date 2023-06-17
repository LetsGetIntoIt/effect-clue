import * as T from '@effect/io/Effect';

import * as App from './App';
import { Effect_expectSucceed, Effect_test } from './utils/EffectTest';

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
                                guesser: ['Kapil'],
                                nonRefuters: [
                                    // None
                                ],
                                refutation: [
                                    ['Kate'],
                                    ['Weapon', 'Knife'],
                                ],
                            },
                        ],
                    }],

                    deductionRulesSetup: [[
                        'cardIsHeldExactlyOnce',
                    ]],
                }),
            ));

            expect(result).toEqual({});
        }));
    });
});
