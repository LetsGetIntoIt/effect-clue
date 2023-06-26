import { pipe, flow, identity } from "@effect/data/Function";
import { D, E, HM, HS, M, O, ROA, ROR, ST, T, TU } from "./utils/EffectImports";
import { HashSet_of } from "./utils/Effect";

import * as CaseFile from "./CaseFile";
import * as Game from "./Game";
import * as Card from "./Card";
import * as CardSet from "./CardSet";
import * as Player from "./Player";
import * as PlayerSet from "./PlayerSet";
import * as Guess from "./Guess";
import * as GuessSet from "./GuessSet";
import * as ConclusionMap from "./ConclusionMap";
import * as DeductionSet from "./DeductionSet";
import * as Range from "./Range";
import * as Conclusion from "./Conclusion";
import * as CardOwner from "./CardOwner";

export const MOCK_CARDS = pipe(
    {
        mustard: { cardType: 'Suspect', label: 'Col. Mustard', },
        plum: { cardType: 'Suspect', label: 'Prof. Plum', },

        wrench: { cardType: 'Weapon', label: 'Wrench', },
        knife: { cardType: 'Weapon', label: 'Knife', },

        conservatory: { cardType: 'Room', label: 'Conservatory', },
        ballRoom: { cardType: 'Room', label: 'Ball room', },
    },

    ROR.map(flow(Card.Card, Card.ValidatedCard, E.getOrThrow)),
);

export const MOCK_PLAYERS = pipe(
    {
        alice: { name: 'Alice' },
        bob: { name: 'Bob' },
        charlie: { name: 'Charlie' },
    },

    ROR.map(flow(Player.Player, Player.ValidatedPlayer, E.getOrThrow)),
);

export const MOCK_CASE_FILES = pipe(
    {
        standard: { label: 'Murder'},
    },

    ROR.map(flow(CaseFile.CaseFile, CaseFile.ValidatedCaseFile, E.getOrThrow)),
);

export const mockGame = ({
    cards = [],
    players = [],
    caseFile = MOCK_CASE_FILES.standard,
}: {
    readonly cards?: readonly Card.ValidatedCard[];
    readonly players?: readonly Player.ValidatedPlayer[];
    readonly caseFile?: CaseFile.ValidatedCaseFile;
} = {
    // By default, pass no individual options
}): Game.Game => {
    const cardSet = pipe(cards, HS.fromIterable, CardSet.ValidatedCardSet, E.getOrThrow);
    const playerSet = pipe(players, HS.fromIterable, PlayerSet.ValidatedPlayerSet, E.getOrThrow);

    const game: Game.Game = Game.Game({
        cards: cardSet,
        players: playerSet,
        caseFile,
    });

    return game;
};

const mockGuessInGame = (
    game: Game.Game,
) => ({
    guesser,
    cards = [],
    nonRefuters = [],
    refutation,
}: {
    readonly guesser: Player.ValidatedPlayer;
    readonly cards?: readonly Card.ValidatedCard[];
    readonly nonRefuters?: readonly Player.ValidatedPlayer[];
    readonly refutation?: {
        readonly refuter: Player.ValidatedPlayer;
        readonly card?: Card.ValidatedCard;
    };
}): Guess.ValidatedGuess =>
    pipe(
        {
            guesser,
            cards,
            nonRefuters,
            refutation,
        },

        // Do some basic conversions of the nullable fields
        ST.evolve({
            guesser: identity<Player.ValidatedPlayer>,
            cards: HS.fromIterable<Card.ValidatedCard>,
            nonRefuters: HS.fromIterable<Player.ValidatedPlayer>,
            refutation: flow(
                O.fromNullable,
                O.map(ST.evolve({
                    refuter: identity<Player.ValidatedPlayer>,
                    card: O.fromNullable<Card.ValidatedCard | undefined>, // TODO fix this
                })),
            ),
        }),

        a => a as any, // TODO fix this

        // Validate the guess
        Guess.Guess,
        Guess.ValidatedGuess,
        T.provideService(Game.Tag, game),

        // Error out if this fails
        T.runSync,
    );

export const mockGuessesInGame = (
    game: Game.Game,
): ((guesses?: readonly {
    readonly guesser: Player.ValidatedPlayer;
    readonly cards?: readonly Card.ValidatedCard[];
    readonly nonRefuters?: readonly Player.ValidatedPlayer[];
    readonly refutation?: {
        readonly refuter: Player.ValidatedPlayer;
        readonly card?: Card.ValidatedCard;
    };
}[]) => GuessSet.ValidatedGuessSet) =>
    flow(
        // Default to an empty array
        O.fromNullable,
        O.getOrElse(ROA.empty),

        // Mock each individual guess
        ROA.map(mockGuessInGame(game)),

        // Validate the complete set of guesses
        HS.fromIterable,
        GuessSet.GuessSet,
        GuessSet.ValidatedGuessSet,

        // Error out if this fails
        E.getOrThrow,
    );

export const mockReasonObserved = (explanation: string): Conclusion.Reason =>
    Conclusion.Reason({
        level: 'observed',
        explanation,
    });

export const mockReasonInferred = (explanation: string): Conclusion.Reason =>
    Conclusion.Reason({
        level: 'inferred',
        explanation,
    });

const toConclusionMapOrThrow: <Q, A>(
    hashMap: HM.HashMap<Q, {
        answer: A;
        reasons: HS.HashSet<Conclusion.Reason>;
    }>
) => ConclusionMap.ValidatedConclusionMap<Q, A> =
    flow(
        HM.mapWithIndex(flow(
            Conclusion.ConclusionOf(),
            Conclusion.ValidatedConclusionOf(),
            E.getOrThrow,
        )),

        ConclusionMap.ConclusionMapOf(),
        ConclusionMap.ValidatedConclusionMapOf(),

        E.getOrThrow,
    );

export const mockDeductionsInGame = (
    game: Game.Game,
    guesses: GuessSet.ValidatedGuessSet,
) => ({
    numCards = [],
    ownership = [],
    refuteCards = [],
}: {
    readonly numCards?: readonly [
        Player.ValidatedPlayer, // The player
        readonly [number, number?],      // An exact count, or (min,max) range of their card count
        { level: 'observed' | 'inferred', explanation: string }, // The reasoning
    ][];

    readonly ownership?: readonly [
        Player.ValidatedPlayer | CaseFile.CaseFile, // The card owner
        Card.ValidatedCard,     // The card
        boolean,                // Do they definitely own (true) or not own (false) this card?
        { level: 'observed' | 'inferred', explanation: string }, // The reasoning
    ][];

    readonly refuteCards?: readonly [
        Guess.ValidatedGuess,   // The guess
        readonly [Card.ValidatedCard, 'owned' | 'maybe'][],     // Which card was used to refute it
        { level: 'observed' | 'inferred', explanation: string }, // The reasoning
    ][];
} = {
    // By default, pass no individual options
}): DeductionSet.ValidatedDeductionSet =>
    pipe(
        {
            numCards,
            ownership,
            refuteCards,
        },

        ST.evolve({
            numCards: flow(
                ROA.map(([player, [minNumCards, maxNumCards], reason]) => TU.tuple(
                    player,

                    {
                        answer: E.getOrThrow(Range.Range(minNumCards, maxNumCards)),
                        reasons: HashSet_of(Conclusion.Reason(reason)),
                    },
                )),

                HM.fromIterable,
                toConclusionMapOrThrow,
            ),

            ownership: flow(
                ROA.map(([owner, card, isOwned, reason]) => TU.tuple(
                    D.array([
                        pipe(
                            M.value(owner),
                            M.tag('Player', (player) => CardOwner.CardOwnerPlayer({ player })),
                            M.tag('CaseFile', (caseFile) => CardOwner.CardOwnerCaseFile({ caseFile })),
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

            refuteCards: flow(
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
        }),

        DeductionSet.DeductionSet,
        DeductionSet.ValidatedDeductionSet,

        T.provideService(Game.Tag, game),
        T.provideService(GuessSet.Tag, guesses),

        T.runSync,
    );
