import { pipe } from '@effect/data/Function';
import { T, B, ROA, E, D, HM, O, HS } from './utils/effect/EffectImports';

import * as ApiSteps from './ApiSteps';
import { Card, CaseFile, Guess, Player } from './objects';
import { DeductionRule } from './logic';

// TODO refactors
// - Replace Either<E, A> with Effect<never, E, A> per this thread: https://discord.com/channels/795981131316985866/1128449901324406784
// - Add logging, services and spans
// - Add diagnostics to the result of the deduce() step (number of iterations, was it exhaustive, etc.)
// - All Error strings from the API should be tagged/structured, instead of "string"
// - Accumulate errors from the API where applicable (instead of failing at the first one)
// - All Conclusion.Reasons should be tagged/structured, instead of string
// - Conclusion.Reasons should be ordered from simplest to most complex
// - DeductionRules should be ordered from simplest to most complex
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
// - Take the map into account, update which is next best guess to make
// - Take the map into account, who should I pull away from their goal
// - Allow for multiple case files
// - Allow each casefile to have a KNOWN 0-many of a card type (ex. a killer and victim, two weapons, no weapons, etc.)

interface ApiInput {
    readonly cards: readonly Card.Serialized[];
    readonly players: readonly Player.Serialized[];
    readonly caseFile: CaseFile.Serialized;

    // TODO known numCards
    // TODO known card ownership

    readonly guesses: readonly Guess.Serialized[];
    
    readonly deductionRules: readonly DeductionRule.Name[];
}

export interface ApiOutput {
    ownership: (
        owner:
            | { type: 'caseFile '}
            | { type: 'player'; player: Player.Serialized },
        card: Card.Serialized,
    ) => {
        readonly isOwned: boolean;
        readonly reasons: string[];
    } | undefined
}

export const run = ({
    cardSetup: cardSetupArgs,
    playersSetup: playersSetupArgs,
    caseFileSetup: caseFileSetupArgs,
    knownDeductionsSetup: knownDeductionsSetupArgs,
    guessesSetup: guessesSetupArgs,
    deductionRulesSetup: deductionRulesSetupArgs,
}: ApiInput): ApiOutput => pipe(
    T.gen(function* ($) {
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
            ownership: (type: 'player' | 'caseFile', ownerName: string, [cardType, cardLabel]: [string, string]) => {
                const owner = 
                    type === 'player'
                        ? pipe(Player.Player({ name: ownerName }), Player.ValidatedPlayer, E.getOrThrow, player => CardOwner.CardOwnerPlayer({ player }))
                        : pipe(CaseFile.CaseFile({ label: ownerName }), CaseFile.ValidatedCaseFile, E.getOrThrow, caseFile => CardOwner.CardOwnerCaseFile({ caseFile }))

                // TODO actually catch and return this error if this is an invalid card?
                const card = Card.decodeSync([cardType, cardLabel]);

                const key = D.array([owner, card] as const);

                const ownership = HM.get(deductions.ownership, key);

                if (O.isNone(ownership)) {
                    return undefined;
                }

                return {
                    isOwned: ownership.value.answer,
                    reasons: pipe(ownership.value.reasons, HS.map((reason) => reason.explanation), HS.values, ROA.fromIterable),
                };
            },
        };
    }),

    T.runSync,
);
