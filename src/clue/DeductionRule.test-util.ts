import { pipe, flow, untupled, tupled } from "@effect/data/Function";
import { E, HS, ROA, T } from "../utils/EffectImports";
import { Effect_expectSucceed } from "../utils/EffectTest";

import * as CaseFile from "./CaseFile";
import * as Game from "./Game";
import * as Card from "./Card";
import * as CardSet from "./CardSet";
import * as Player from "./Player";
import * as PlayerSet from "./PlayerSet";
import * as Guess from "./Guess";
import * as GuessSet from "./GuessSet";
import * as ConclusionMapSet from "./ConclusionMapSet";

export const mockCardMustard: Parameters<typeof Card.Card> = [{ cardType: 'Card', label: "Col. Mustard" }];

export const mockPlayerAlice:   Parameters<typeof Player.Player> = [{ name: 'Alice' }];
export const mockPlayerBob:     Parameters<typeof Player.Player> = [{ name: 'Bob' }];
export const mockPlayerCharlie: Parameters<typeof Player.Player> = [{ name: 'Charlie' }];

export const mockCaseFileStandard: Parameters<typeof CaseFile.CaseFile> = [{ label: 'Murder'}];

export const testSetupGame = ({
    cards: rawCards = [],
    players: rawPlayers = [],
    caseFile: rawCaseFile = mockCaseFileStandard,
}: {
    readonly cards: readonly Parameters<typeof Card.Card>[];
    readonly players: readonly Parameters<typeof Player.Player>[];
    readonly caseFile: Parameters<typeof CaseFile.CaseFile>;
}): T.Effect<never, never, Game.Game> =>
    Effect_expectSucceed(T.gen(function* ($) {
        const cards = yield* $(Effect_expectSucceed(pipe(
            rawCards,
            ROA.map(flow(tupled(Card.Card), Card.ValidatedCard)),
            ROA.sequence(E.Applicative),

            E.flatMap(flow(
                HS.fromIterable,
                CardSet.ValidatedCardSet,
            )),
        )));

        const players = yield* $(Effect_expectSucceed(pipe(
            rawPlayers,
            ROA.map(flow(tupled(Player.Player), Player.ValidatedPlayer)),
            ROA.sequence(E.Applicative),

            E.flatMap(flow(
                HS.fromIterable,
                PlayerSet.ValidatedPlayerSet,
            )),
        )));

        const caseFile = yield* $(Effect_expectSucceed(pipe(
            rawCaseFile,
            tupled(CaseFile.CaseFile),
            CaseFile.ValidatedCaseFile,
        )));

        const game: Game.Game = Game.Game({
            cards,
            players,
            caseFile,
        });

        return game;
    }));

export const testSetupGuesses = ({
    game,
    guesses = [],
}: {
    readonly game: Game.Game;
    readonly guesses: readonly {
        cards: readonly Parameters<typeof Card.Card>[];
    }[];
}): T.Effect<never, never, GuessSet.ValidatedGuessSet> =>
    Effect_expectSucceed(T.gen(function* ($) {
        const guesses = yield* $(Effect_expectSucceed(pipe(
            [
                Guess.Guess({ })
            ],
            ROA.map(Card.ValidatedCard),
            ROA.sequence(E.Applicative),

            E.flatMap(flow(
                HS.fromIterable,
                CardSet.ValidatedCardSet,
            )),
        )));
    }));

export const testSetupConclusions = ({
    game,
    numCards = [],
    ownership = [],
    refuteCards = [],
}: {
    readonly game: Game.Game;
    readonly numCards: readonly {}[];
    readonly ownership: readonly {}[];
    readonly refuteCards: readonly {}[];
}): T.Effect<never, never, ConclusionMapSet.ValidatedConclusionMapSet> =>
    Effect_expectSucceed(T.gen(function* ($) {
        // TODO
    }));
