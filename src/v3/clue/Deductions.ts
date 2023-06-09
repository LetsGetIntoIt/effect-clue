import * as ROA from "@effect/data/ReadonlyArray";
import * as O from '@effect/data/Option';
import * as HM from "@effect/data/HashMap";
import * as HS from '@effect/data/HashSet';
import * as T from '@effect/io/Effect';
import * as ST from "@effect/data/Struct";
import * as E from '@effect/data/Either';
import { flow, identity, pipe } from "@effect/data/Function";

import { HashMap_setOrFail, Show_show } from "../utils/ShouldBeBuiltin";
import {dedent} from "ts-dedent";

import * as PlayerSet from "./PlayerSet";
import * as Card from './Card';
import * as CardSet from './CardSet';
import * as CardHolder from './CardHolder';
import * as Guess from './Guess';
import * as GuessSet from './GuessSet';

interface Reason {
    level: 'observed' | 'inferred' | 'suspected';
    description: string;
}

interface OwnershipConclusionKey {
    holder: CardHolder.CardHolder;
    card: Card.Card;
}

interface OnwershipConclusionValue {
    has: boolean;
}

interface RefutationConclusionKey {
    guess: Guess.Guess; // TODO replace with an ID?
}

interface RefutationConclusionValue {
    card: Card.Card;
}

interface Conclusions {
    ownership: HM.HashMap<OwnershipConclusionKey, [OnwershipConclusionValue, Reason]>;
    refutations: HM.HashMap<RefutationConclusionKey, [RefutationConclusionValue, Reason]>;
}

const setOwnership = (key: OwnershipConclusionKey, [value, reason]: [OnwershipConclusionValue, Reason]): ((conclusions: Conclusions) => E.Either<string, Conclusions>) =>
    flow(
        // Try to add the new ownership
        ST.evolve({
            ownership: HashMap_setOrFail(key, [value, reason]),
            refutations: E.right<Conclusions['refutations']>,
        }),
        E.struct,

        // Handle the case that ownership is already set
        // TODO if they have the same value, should it append the reason?
        E.mapLeft(([existingValue, existingReason]) => dedent`
            Cannot update conclusion about ownership:
                Holder = ${CardHolder.show(key.holder)}
                Card = ${Show_show(key.card)}
                Has = ${value.has}
                Reason = ${Show_show(reason)}

            Conflicting ownership conclusion already exists:
                Has = ${existingValue.has}
                Reason = ${Show_show(existingReason)}
        `)
    );

const setRefutation = (key: RefutationConclusionKey, [value, reason]: [RefutationConclusionValue, Reason]): ((conclusions: Conclusions) => E.Either<string, Conclusions>) =>
    flow(
        // Try to add the new ownership
        ST.evolve({
            ownership: E.right<Conclusions['ownership']>,
            refutations: HashMap_setOrFail(key, [value, reason]),
        }),
        E.struct,

        // Handle the case that ownership is already set
        // TODO if they have the same value, should it append the reason?
        E.mapLeft(([existingValue, existingReason]) => dedent`
            Cannot update conclusion about refutation card:
                Guess = ${Show_show(key.guess)}
                Card = ${Show_show(value.card)}
                Reason = ${Show_show(reason)}

            Conflicting ownership conclusion already exists:
                Card = ${Show_show(existingValue.card)}
                Reason = ${Show_show(existingReason)}
        `)
    );

type Deduction = (conclusions: Conclusions) => T.Effect<CardSet.CardSet | PlayerSet.PlayerSet | GuessSet.GuessSet, never, Conclusions>;

const cardOwnedExactlyOnce: Deduction = (initialConclusions) => T.gen(function* ($) {
    const { cards } = yield* $(CardSet.Tag);
    const { players } = yield* $(PlayerSet.Tag);

    HS.forEach(cards, card => {
        const [definiteHoldingPlayers, otherPlayers] = ROA.partition(
            players,
            player => true, // TODO figure this out
        );

        // If definiteHoldingPlayers < 1
            // If otherPlayers === N-1, mark this person as having it
            // else do nothing
        // If definiteHoldingPlayers === 1, mark everyone else as not having it
        // If definiteHoldingPlayers > 1, error out
    });

    // - Each card must have exactly 1 "yes"
    // -    "__ has the card, so nobody else can"
    // -    "Nobody else has the card, so ___ must have it"
});

const caseFileOwnsExactlyOneOfEachType: Deduction = (conclusions) => T.gen(function* ($) {
    // - The Case File must has exacxtly 1 "yes" of each card type
    // -    "The Case File has ___, so it cannot also have ___"
    // -    "The Case File has no other ____s, so it must be ___"
});

const eachPlayerOwnsExactly: Deduction = (conclusions) => T.gen(function* ($) {
    // - Each player must have exactly so many cards
    // -    "All of ___'s card are accounted for, so they cannot have this"
    // -    "All of ___'s cards have been rules out, so they must have this" 
});

const nonRefuterDoesNotOwn: Deduction = (conclusions) => T.gen(function* ($) {
    // - Any player that skips refutation does not have those cards
    // -    "___ could not refute guess ___, so they cannot have this"
});

const refuterUsesOwnedCard: Deduction = (conclusions) => T.gen(function* ($) {
    // - Any player that refutes a guess, did so with a card we know they have
    // -    "___ has ___, so they could have refuted guess ____ with it"
});

const refuterHasOneOf: Deduction = (conclusions) => T.gen(function* ($) {
    // - Any player that refutes a guess, must have one of those cards
    // -    "___ refuted guess ____, so they must have one of ___, ___, ___"
});
