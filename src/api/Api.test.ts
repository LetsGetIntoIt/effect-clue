
import * as App from './Api';

describe('App', () => {
    test('scenario 1', async () => {
        const result = await App.run({
            cardSetup: [{
                useStandard: 'North America',

                extraCards: [
                    ['Room', 'Dog house'],
                ],
            }],

            playersSetup: [{
                players: [
                    ['Kapil'],
                    ['Kate'],
                    ['Karthik'],
                ],
            }],

            caseFileSetup: [{
                caseFile: ['Murder'],
            }],

            knownDeductionsSetup: [{
                knownNumCards: [
                    [['Kapil'], 5],
                    [['Kate'], 10],
                ],

                knownCardOwners: [
                    [['Kapil'], ['Room', 'Dog house'], true],
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
                'cardIsHeldAtLeastOnce',
                'cardIsHeldAtMostOnce',
            ]],
        });

        // TODO actually write tests and assert stuff
        expect(result).toBeDefined();
    });
});
