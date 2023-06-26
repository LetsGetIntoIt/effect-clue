
import { T, B } from './utils/EffectImports';

import * as ApiSteps from './ApiSteps';
import * as DeductionSet from './DeductionSet';

// TODO refactors
// - Add logging, services and spans
// - Add diagnotics to the result of the deduce() step (number of iterations, was it exhaustive, etc.)
// - All Error strings from the API should be tagged/structured, instead of "string"
// - Accumulate errors from the API where applicable (instead of failing at the first one)
// - All Conclusion.Reasons should be tagged/structured, instead of string
// - Conclusion.Reasons should be ordered from simplest to most complex
// - DeductionRules should be ordered from simplest to most complex
// - use @effect/schema to validate data into the Api
// - use TSPlus and see if a lot of interfaces/typeclasses/classes/constuctor code can be deduped
// - Simplify Guess by converting to a tagged class for the 3 different possible cases: Unrefuted, RefutedUnknown, RefutedKnown
// - ^ Update DeductionRule to only add refuted cards for RefutedUnknown guesses

// TODO more features
// - New deduction rule: simulated dealing. Branch through the possible ways the cards could have been dealt, and eliminate any paradoxical ones
// - Add probabilities using simulated dealing. How many hands of the possible arrangements have (owner, card)=true?
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
    knownDeductionsSetup: Parameters<typeof ApiSteps.setupKnownDeductions>;
    guessesSetup: Parameters<typeof ApiSteps.setupGuesses>;
    deductionRulesSetup: Parameters<typeof ApiSteps.setupDeductionRules>;
}

interface ApiOutput {
    // TODO don't leak out this internal type. Convert it to some raw output
    deductions: DeductionSet.ValidatedDeductionSet;
}

export const run = ({
    cardSetup: cardSetupArgs,
    playersSetup: playersSetupArgs,
    caseFileSetup: caseFileSetupArgs,
    knownDeductionsSetup: knownDeductionsSetupArgs,
    guessesSetup: guessesSetupArgs,
    deductionRulesSetup: deductionRulesSetupArgs,
}: ApiInput): T.Effect<never, B.Brand.BrandErrors, ApiOutput> => T.gen(function* ($) {
    const cards = yield* $(ApiSteps.setupCards(...cardSetupArgs));
    const players = yield* $(ApiSteps.setupPlayers(...playersSetupArgs));
    const caseFile = yield* $(ApiSteps.setupCaseFile(...caseFileSetupArgs));

    const game = yield* $(ApiSteps.setupGame({ cards, players, caseFile }));

    const knownDeductions = yield* $(
        ApiSteps.setupKnownDeductions(...knownDeductionsSetupArgs),
        ApiSteps.provideGame(game),
    );

    const guesses = yield* $(
        ApiSteps.setupGuesses(...guessesSetupArgs),
        ApiSteps.provideGame(game),
    );

    const deductionRule = yield* $(ApiSteps.setupDeductionRules(...deductionRulesSetupArgs));

    const deductions = yield* $(
        knownDeductions,
        ApiSteps.deduce(deductionRule),

        ApiSteps.provideGame(game),
        ApiSteps.provideGuesses(guesses),
    );

    return {
        deductions,
    };
});
