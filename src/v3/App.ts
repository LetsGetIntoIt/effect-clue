import * as E from '@effect/data/Either';

import * as Clue from './clue';

// TODO refactors
// - Guess.create() should validate that all the cards, nonRefuters, refuteCards, etc. make sense
// - All Error strings from the API should be tagged/structured, instead of "string"
// - Accumulate errors from the API where applicable (instead of failing at the first one)
// - All Conclusion.Reasons should be tagged/structured, instead of string
// - Conclusion.Reasons should be ordered from simplest to most complex
// - DeductionRules should be ordered from simplest to most complex
// - CardType should become its own object with a display label (maybe eventually, users can set the card types in a separate step)
// - Typeclass usage: stop passing around Equivalence, Refinement and Show instances everywhere
// - use generator syntax wherever possible
// - convert any logical validations into typings. Make bad states unrepresentable
// - use @effect/schema to validate data into the Api
// - use TSPlus and see if a lot of interfaces/typeclasses/classes/constuctor code can be deduped
// - Simplify Guess by converting to a tagged class for the 3 different possible cases: Unrefuted, RefutedUnknown, RefutedKnown
// - ^ Update DeductionRule to only add refuted cards for RefutedUnknown guesses
// - Implement CardSet.MonoidUnion, and make StandardNorthAmericaCardSet a regular CardSet, rather than a function to add all the standard cards

// TODO more features
// - Save and load games from localStorage
// - Who I've shown what (and which card I should show to refute)
// - See what other people should know (by direct observation and inference)
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

        knownCardOwners: [
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

    const deductionRules = yield* $(Clue.setupDeductionRules());

    // This will live in the App, and be passed into each component to render extra stuff
    const deducedConclusions = yield* $(Clue.setupDeducedConclusions());

});
