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
                            ['room', 'doghouse'],
                        ],
                    }],
        
                    ownersSetup: [{
                        players: [
                            ['kapil'],
                            ['kate'],
                        ],
                    
                        caseFiles: [
                            ['murder'],
                        ],
                    }],
        
                    knownConclusionsSetup: [{
                        knownNumCards: [
                            [['kapil'], 5],
                            [['kate'], 10],
                        ],
            
                        knownCardOwners: [
                            [['kapil'], ['room', 'doghouse']],
                        ],
                    }],
        
                    guessesSetup: [{
                        guesses: [
                            {
                                cards: [
                                    ['person', 'mustard'],
                                    ['weapon', 'knife'],
                                    ['room', 'doghouse'],
                                ],
                                guesser: ['kapil'],
                                nonRefuters: [
                                    // None
                                ],
                                refutation: [
                                    ['kate'],
                                    ['weapon', 'knife'],
                                ],
                            },
                        ],
                    }],
        
                    deductionRulesSetup: ['all'],
                }),
            ));

            expect(result).toEqual({});
        }));
    });
});
