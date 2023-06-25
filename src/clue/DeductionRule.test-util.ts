import { pipe, flow, identity } from "@effect/data/Function";
import { E, HM, HS, O, ROA, ROR, ST, T } from "../utils/EffectImports";

import * as CaseFile from "./CaseFile";
import * as Game from "./Game";
import * as Card from "./Card";
import * as CardSet from "./CardSet";
import * as Player from "./Player";
import * as PlayerSet from "./PlayerSet";
import * as Guess from "./Guess";
import * as GuessSet from "./GuessSet";
import * as ConclusionMap from "./ConclusionMap";
import * as ConclusionMapSet from "./ConclusionMapSet";
import * as Range from "./Range";
import * as Conclusion from "./Conclusion";

export const MOCK_CARDS = pipe(
    {
        mustard: { cardType: 'Suspect', label: 'Col. Mustard', },
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

export const mockConclusionsInGame = (
    game: Game.Game,
    guesses: GuessSet.ValidatedGuessSet,
) => ({
    numCards = [],
    ownership = [],
    refuteCards = [],
}: {
    readonly numCards?: readonly [
        Player.ValidatedPlayer, // The player
        [number, number?],      // An exact count, or (min,max) range of their card count
    ][];

    readonly ownership?: readonly [
        Player.ValidatedPlayer, // The player
        Card.ValidatedCard,     // The card
        boolean,                // Do they definitely own (true) or not own (false) this card?
    ][];

    readonly refuteCards?: readonly [
        [ /* TODO guess */ ],   // The guess
        Card.ValidatedCard,     // Which card was used to refute it
    ][];
} = {
    // By default, pass no individual options
}): ConclusionMapSet.ValidatedConclusionMapSet =>
    pipe(
        {
            numCards,
            ownership,
            refuteCards,
        },

        ST.evolve({
            numCards: a => a as unknown as HM.HashMap<Player.Player, Conclusion.Conclusion<Range.Range>>,
            ownership: a => a as unknown as HM.HashMap<any, Conclusion.Conclusion<any>>,
            refuteCards: a => a as unknown as HM.HashMap<any, Conclusion.Conclusion<any>>,
        }),

        ST.evolve({
            numCards: HM.map(flow(Conclusion.ValidatedConclusionOf(), E.getOrThrow)),
            ownership: HM.map(flow(Conclusion.ValidatedConclusionOf(), E.getOrThrow)),
            refuteCards: HM.map(flow(Conclusion.ValidatedConclusionOf(), E.getOrThrow)),
        }),

        ST.evolve({
            numCards: flow(ConclusionMap.ConclusionMapOf(), ConclusionMap.ValidatedConclusionMapOf(), E.getOrThrow),
            ownership: flow(ConclusionMap.ConclusionMapOf(), ConclusionMap.ValidatedConclusionMapOf(), E.getOrThrow),
            refuteCards: flow(ConclusionMap.ConclusionMapOf(), ConclusionMap.ValidatedConclusionMapOf(), E.getOrThrow),
        }),

        ConclusionMapSet.ConclusionMapSet,
        ConclusionMapSet.ValidatedConclusionMapSet,

        T.provideService(Game.Tag, game),
        T.provideService(GuessSet.Tag, guesses),

        E.getOrThrow,
    );
