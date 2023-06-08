import * as E from '@effect/data/Either';
import * as HS from "@effect/data/HashSet";
import * as ST from "@effect/data/Struct";

import * as Guess from './Guess';

export interface GuessHistory {
    readonly guesses: HS.HashSet<Guess.Guess>;
}

export const empty: GuessHistory =
    Object.freeze({
        guesses: HS.empty(),
    });

export const add = (newGuess: Guess.Guess) =>
                (initialHistory: GuessHistory):
                GuessHistory =>
    ST.evolve(initialHistory, {
        guesses: HS.add(newGuess)
    });

export interface ValidatedGuessHistory extends GuessHistory {
    validated: true;
}

export const validate = (guessHistory: GuessHistory): E.Either<string[], ValidatedGuessHistory> =>
    E.right(
        // TODO validate the Guess History for real

        Object.freeze({
            ...guessHistory,
            validated: true,
        })
    );
