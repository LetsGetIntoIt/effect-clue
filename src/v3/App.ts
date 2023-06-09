import * as E from '@effect/data/Either';

import * as Clue from './clue';

// TODO refactors
// - use generator syntax wherever possible
// - convert any logical validations into typings. Make bad states unrepresentable

// TODO more features
// - Who I've shown what (and which card I should show to refute)
// - Best next guesses to make (not taking map into account)
// - Best next guesses to make, given you're in a particular room
// - Test hypotheses to find paradoxes
// - Percent likelihood
// - Take the map into account, update which is next best guess to make
// - Take the map into account, who should I pull away from their goal

interface AppState {

}

const app: E.Either<string[], AppState> = E.gen(function* ($) {
    // This will live in a component, returning the validated result or nothing
    const cards = yield* $(Clue.setupCards({
        useStandard: 'North America',

        extraCards: [
            ['room', 'doghouse'],
        ],
    }));

    // This will live in a component, returning the validated result or nothing
    const players = yield* $(Clue.setupPlayers({
        names: [
            ['kapil'],
            ['kate'],
        ]
    }));

    // This will live in a component, returning the validated result or nothing
    const knownConclusions = yield* $(Clue.setupKnownConclusions({
        knownNumCards: [
            [['kapil'], 5],
            [['kate'], 10],
        ],

        knownCardHolders: [
            [['kapil'], ['room', 'doghouse']],
        ],
    }));

    // This will live in one component, returning the validated result or nothing
    const guesses = yield* $(Clue.setupGuesses({
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
    }));

    const deductions = yield* $(Clue.setupDeductions());

    // This will live in the App, and be passed into each component to render extra stuff
    const deducedConclusions = yield* $(Clue.setupDeducedConclusions());

});
