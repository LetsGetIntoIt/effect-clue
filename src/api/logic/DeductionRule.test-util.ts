import { D, HM, HS, M, ROA, T, TU } from "../utils/effect/EffectImports";
import { pipe } from "@effect/data/Function";
import { HashSet_of, undefinedToNull } from "../utils/effect/Effect";

import { Card, CaseFile, Player, Guess } from "../objects";
import { CardOwner, Game } from "../game";

import * as Range from './utils/Range';
import * as Conclusion from "./utils/Conclusion";
import * as ConclusionMap from "./utils/ConclusionMap";
import * as DeductionSet from './DeductionSet';

export const MOCK_CARDS = {
    mustard: Card.decodeSync(['Suspect', 'Col. Mustard']),
    plum: Card.decodeSync(['Suspect', 'Prof. Plum']),

    wrench: Card.decodeSync(['Weapon', 'Wrench']),
    knife: Card.decodeSync(['Weapon', 'Knife']),

    conservatory: Card.decodeSync(['Room', 'Conservatory']),
    ballRoom: Card.decodeSync(['Room', 'Ball room']),
};

export const MOCK_PLAYERS = {
    alice: Player.decodeSync(['Alice']),
    bob: Player.decodeSync(['Bob']),
    charlie: Player.decodeSync(['Charlie']),
};

export const MOCK_CASE_FILES = {
    standard: CaseFile.standard,
};

const toConclusionMapOrThrow = <Q, A>(
    hashMap: HM.HashMap<Q, {
        answer: A;
        reasons: HS.HashSet<Conclusion.Reason>;
    }>
): ConclusionMap.ValidatedConclusionMap<Q, A> =>
    pipe(
        hashMap,

        HM.mapWithIndex(({ answer, reasons }) => pipe(
            Conclusion.of(answer, reasons),
        )),

        ConclusionMap.ConclusionMapOf(),
        ConclusionMap.ValidatedConclusionMapOf(),

        T.runSync,
    );

export const mockDeductionsInGame = (
    game: Game.Game,
) => ({
    numCards = [],
    ownership = [],
    refuteCards = [],
}: {
    readonly numCards?: readonly [
        Player.Player, // The player
        readonly [number, number?],      // An exact count, or (min,max) range of their card count
        { level: 'observed' | 'inferred', explanation: string }, // The reasoning
    ][];

    readonly ownership?: readonly [
        Player.Player | CaseFile.CaseFile, // The card owner
        Card.Card,     // The card
        boolean,                // Do they definitely own (true) or not own (false) this card?
        { level: 'observed' | 'inferred', explanation: string }, // The reasoning
    ][];

    readonly refuteCards?: readonly [
        Guess.Guess,   // The guess
        readonly [Card.Card, 'owned' | 'maybe'][],     // Which card was used to refute it
        { level: 'observed' | 'inferred', explanation: string }, // The reasoning
    ][];
} = {
    // By default, pass no individual options
}): DeductionSet.ValidatedDeductionSet =>
    pipe(
        {
            numCards: pipe(
                numCards,
                
                ROA.map(([player, [minNumCards, maxNumCards], reason]) => TU.tuple(
                    player,

                    {
                        answer: Range.decodeSync([minNumCards, undefinedToNull(maxNumCards)]),
                        reasons: HashSet_of(Conclusion.Reason(reason)),
                    },
                )),

                HM.fromIterable,
                toConclusionMapOrThrow,
            ),

            ownership: pipe(
                ownership,

                ROA.map(([owner, card, isOwned, reason]) => TU.tuple(
                    D.array([
                        pipe(
                            M.value(owner),
                            M.when(Player.is, (player) => CardOwner.CardOwnerPlayer({ player })),
                            M.when(CaseFile.is, (caseFile) => CardOwner.CardOwnerCaseFile({ caseFile })),
                            M.exhaustive,
                        ),

                        card,
                    ] as const),

                    {
                        answer: isOwned,
                        reasons: HashSet_of(Conclusion.Reason(reason)),
                    },
                )),

                HM.fromIterable,
                toConclusionMapOrThrow,
            ),

            refuteCards: pipe(
                refuteCards,
                
                ROA.map(([guess, cards, reason]) => TU.tuple(
                    guess,

                    {
                        answer: HM.fromIterable(cards),
                        reasons: HashSet_of(Conclusion.Reason(reason)),
                    },
                )),

                HM.fromIterable,
                toConclusionMapOrThrow,
            ),
        },

        DeductionSet.DeductionSet,
        DeductionSet.ValidatedDeductionSet,

        T.provideService(Game.Tag, game),

        T.runSync,
    );
