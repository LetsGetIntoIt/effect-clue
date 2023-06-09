import * as E from '@effect/data/Either';
import * as HS from "@effect/data/HashSet";
import * as ST from "@effect/data/Struct";
import * as CTX from '@effect/data/Context';

import * as Guess from './Guess';

export interface GuessSet {
    readonly guesses: HS.HashSet<Guess.Guess>;
}

export const Tag = CTX.Tag<GuessSet>();

export const empty: GuessSet =
    Object.freeze({
        guesses: HS.empty(),
    });

export const add = (newGuess: Guess.Guess) =>
                (initialSet: GuessSet):
                GuessSet =>
    ST.evolve(initialSet, {
        guesses: HS.add(newGuess)
    });

export interface ValidatedGuessSet extends GuessSet {
    validated: true;
}

export const validate = (guessSet: GuessSet): E.Either<string[], ValidatedGuessSet> =>
    E.right(
        // TODO validate the guesses for real

        Object.freeze({
            ...guessSet,
            validated: true,
        })
    );
