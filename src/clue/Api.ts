import * as B from '@effect/data/Brand';
import * as T from '@effect/io/Effect';

import * as ApiSteps from './ApiSteps';
import * as ConclusionMapSet from './ConclusionMapSet';

// TODO refactors
// - Add logging, services and spans
// - Guess.create() should validate that all the cards, nonRefuters, refuteCards, etc. make sense
// - All Error strings from the API should be tagged/structured, instead of "string"
// - Accumulate errors from the API where applicable (instead of failing at the first one)
// - All Conclusion.Reasons should be tagged/structured, instead of string
// - Conclusion.Reasons should be ordered from simplest to most complex
// - DeductionRules should be ordered from simplest to most complex
// - CardType should become its own object with a display label (maybe eventually, users can set the card types in a separate step)
// - use generator syntax wherever possible
// - convert any logical validations into typings. Make bad states unrepresentable
// - use @effect/schema to validate data into the Api
// - use TSPlus and see if a lot of interfaces/typeclasses/classes/constuctor code can be deduped
// - Simplify Guess by converting to a tagged class for the 3 different possible cases: Unrefuted, RefutedUnknown, RefutedKnown
// - ^ Update DeductionRule to only add refuted cards for RefutedUnknown guesses
// - Implement CardSet.MonoidUnion, and make StandardNorthAmericaCardSet a regular CardSet, rather than a function to add all the standard cards

// TODO more features
// - Update player number of cards to be a range
// - - New RageExact / RangeBounded object. getMin() getMax(). clampMax() and clampMin() functions
// - - Update "player has at most/least" deductiont to use the getMin() getMax() of their cards
// - - New deductions: if a player has refuted something, they have at least that many cards
// - - New deductions: each player has a maximum of TOTAL CARDS - SUM(min cards) of every other player
// - Deduction: if a player has refuted {A, B, C} and {C, D, E} and they have only 1 card unaccounted, then they have C
// - Save and load games from localStorage
// - Who I've shown what (and which card I should show to refute)
// - See what other people should know (by direct observation and inference)
// - Best next guesses to make (not taking map into account)
// - Best next guesses to make, given you're in a particular room
// - Test hypotheses to find paradoxes
// - Percent likelihood
// - Take the map into account, update which is next best guess to make
// - Take the map into account, who should I pull away from their goal
// - Allow for multiple case files
// - Allow each casefile to have a KNOWN 0-many of a card type (ex. a killer and victim, two weapons, no weapons, etc.)

interface ApiInput {
    cardSetup: Parameters<typeof ApiSteps.setupCards>;
    playersSetup: Parameters<typeof ApiSteps.setupPlayers>;
    caseFileSetup: Parameters<typeof ApiSteps.setupCaseFile>;
    knownConclusionsSetup: Parameters<typeof ApiSteps.setupKnownConclusions>;
    guessesSetup: Parameters<typeof ApiSteps.setupGuesses>;
    deductionRulesSetup: Parameters<typeof ApiSteps.setupDeductionRules>;
}

interface ApiOutput {
    // TODO don't leak out this internal type. Convert it to some raw output
    conclusions: ConclusionMapSet.ValidatedConclusionMapSet;
}

export const run = ({
    cardSetup: cardSetupArgs,
    playersSetup: playersSetupArgs,
    caseFileSetup: caseFileSetupArgs,
    knownConclusionsSetup: knownConclusionsSetupArgs,
    guessesSetup: guessesSetupArgs,
    deductionRulesSetup: deductionRulesSetupArgs,
}: ApiInput): T.Effect<never, B.Brand.BrandErrors, ApiOutput> => T.gen(function* ($) {
    const cards = yield* $(ApiSteps.setupCards(...cardSetupArgs));
    const players = yield* $(ApiSteps.setupPlayers(...playersSetupArgs));
    const caseFile = yield* $(ApiSteps.setupCaseFile(...caseFileSetupArgs));

    const game = yield* $(ApiSteps.setupGame({ cards, players, caseFile }));

    const knownConclusions = yield* $(
        ApiSteps.setupKnownConclusions(...knownConclusionsSetupArgs),
        ApiSteps.provideGame(game),
    );

    const guesses = yield* $(
        ApiSteps.setupGuesses(...guessesSetupArgs),
        ApiSteps.provideGame(game),
    );

    const deductionRule = yield* $(ApiSteps.setupDeductionRules(...deductionRulesSetupArgs));

    const deducedConclusions = yield* $(
        knownConclusions,
        ApiSteps.deduceConclusions(deductionRule),

        ApiSteps.provideGame(game),
        ApiSteps.provideGuesses(guesses),
    );

    return {
        conclusions: deducedConclusions,
    };
});
