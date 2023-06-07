import * as E from '@effect/data/Either';
import * as H from '@effect/data/Hash';
import * as HS from "@effect/data/HashSet";
import * as EQ from "@effect/data/Equal";
import * as ST from "@effect/data/Struct";
import * as ROA from "@effect/data/ReadonlyArray";
import * as S from '@effect/data/String';
import * as O from '@effect/data/Option';
import { pipe, flow } from '@effect/data/Function';

/* CARD SETUP */

class Card implements EQ.Equal {
    public static readonly _tag: unique symbol = Symbol("Card");

    constructor(
        public readonly cardType: string,
        public readonly label: string
    ) {
        this.cardType = cardType;
        this.label = label;
    }

    [EQ.symbol](that: EQ.Equal): boolean {
        return (that instanceof Card)
            && ST.getEquivalence({
                cardType: S.Equivalence,
                label: S.Equivalence,
            })(this, that);
    }

    [H.symbol](): number {
        return H.structure({
            ...this
        });
    }
}

interface CardSetup {
    readonly cards: HS.HashSet<Card>;
}

const emptyCardSetup = (): CardSetup => Object.freeze({
    cards: HS.empty(),
});

const addCard = (newCard: Card) =>
                (initialSetup: CardSetup):
                CardSetup =>
    ST.evolve(initialSetup, {
        cards: HS.add(newCard)
    });

interface ValidatedCardSetup extends CardSetup {
    validated: true;
    cardTypes: HS.HashSet<string>;
}

const validateCardSetup = (cardSetup: CardSetup): E.Either<string, ValidatedCardSetup> =>
    E.right(
        // TODO validate the card setup for real

        Object.freeze({
            ...cardSetup,
            cardTypes: HS.map(cardSetup.cards, card => card.cardType),
            validated: true,
        })
    );

const standardNorthAmericaCardSetup = (): ValidatedCardSetup => pipe(
    emptyCardSetup(),

    flow(
        addCard(new Card('person', 'scarlet')),
        addCard(new Card('person', 'mustard')),
        addCard(new Card('person', 'white')),
        addCard(new Card('person', 'green')),
        addCard(new Card('person', 'peacock')),
        addCard(new Card('person', 'plum')),
    ),

    flow(
        addCard(new Card('weapon', 'candlestick')),
        addCard(new Card('weapon', 'knife')),
        addCard(new Card('weapon', 'pipe')),
        addCard(new Card('weapon', 'revolver')),
        addCard(new Card('weapon', 'rope')),
        addCard(new Card('weapon', 'wrench')),
    ),

    flow(
        addCard(new Card('room', 'kitchen')),
        addCard(new Card('room', 'ballroom')),
        addCard(new Card('room', 'conservatory')),
        addCard(new Card('room', 'dining room')),
        addCard(new Card('room', 'billiard room')),
        addCard(new Card('room', 'library')),
        addCard(new Card('room', 'lounge')),
        addCard(new Card('room', 'hall')),
        addCard(new Card('room', 'study')),
    ),

    validateCardSetup,

    E.getOrElse(reason => {
        throw new Error(`Unexpected North America set is invalid: ${reason}`);
    }),
);

/* PLAYER SETUP */

class Player implements EQ.Equal {
    public static readonly _tag: unique symbol = Symbol("Player");

    constructor(
        public readonly label: string,
    ) {
        this.label = label;
    }

    [EQ.symbol](that: EQ.Equal): boolean {
        return (that instanceof Player)
            && ST.getEquivalence({
                label: S.Equivalence,
            })(this, that);
    }

    [H.symbol](): number {
        return H.structure({
            ...this
        });
    }
}

interface PlayerSetup {
    readonly players: HS.HashSet<Player>
}

const emptyPlayerSetup = (): PlayerSetup => Object.freeze({
    players: HS.empty(),
});

const addPlayer = (player: Player) =>
                  (initialSetup: PlayerSetup):
                  PlayerSetup =>
    ST.evolve(initialSetup, {
        players: HS.add(player)
    });

interface ValidatedPlayerSetup extends PlayerSetup {
    validated: true;
}

const validatePlayerSetup = (playerSetup: PlayerSetup): E.Either<string, ValidatedPlayerSetup> =>
    E.right(
        // TODO validate the card setup for real

        Object.freeze({
            ...playerSetup,
            validated: true,
        })
    );    

/** CARD DEALING */

// TODO add how many cards each player has

/* GUESSES */

class Guess implements Guess {
    public static readonly _tag: unique symbol = Symbol("Guess");

    constructor(
        public readonly id: number,
        public readonly cards: HS.HashSet<Card>,
        public readonly guesser: Player,
        public readonly nonRefuters: HS.HashSet<Player>,
        public readonly refutation: O.Option<{
            refuter: Player;
            card: O.Option<Card>;
        }>,
    ) {
    }

    [EQ.symbol](that: EQ.Equal): boolean {
        return (that instanceof Card)
                && ST.getEquivalence({
                    cards: ,
                    guesser: ,
                    nonRefuters: ,
                    refuter: ,
                    refuteCard: ,
                })(this, that);
    }

    [H.symbol](): number {
        return H.structure({
            ...this
        });
    }
}

/* DEDUCTIONS */

interface Reason {
    level: 'observed' | 'inferred' | 'suspected';
    description: string;
}

interface Deduction<Conclusion> {
    conclusion: Conclusion;
    reasons: ROA.NonEmptyArray<Reason>;
}

interface GameDeductions<CardType extends string, CardLabel extends string, PlayerLabel extends string> {
    // Table of
    // rows: cards of each type
    // columns: case file and each player
    // values: Deduction<'has', 'does not have'>

    // Updates to the guess history, filling in refute cards
}

// Deduction rules
// - Each row must have exactly 1 "yes"
// -    "__ has the card, so nobody else can"
// -    "Nobody else has the card, so ___ must have it"
// - The Case File must has exacxtly 1 "yes" of each card type
// -    "The Case File has ___, so it cannot also have ___"
// -    "The Case File has no other ____s, so it must be ___"
// - Each player must have exactly so many cards
// -    "All of ___'s card are accounted for, so they cannot have this"
// -    "All of ___'s cards have been rules out, so they must have this"
// - Any player that skips refutation does not have those cards
// -    "___ could not refute guess ___, so they cannot have this"
// - Any player that refutes a guess, did so with a card we know they have
// -    "___ has ___, so they could have refuted guess ____ with it"
// - Any player that refutes a guess, must have one of those cards
// -    "___ refuted guess ____, so they must have one of ___, ___, ___"

// Other features
// - Who I've shown what (and which card I should show to refute)
// - Best next guesses to make (not taking map into account)
// - Best next guesses to make, given you're in a particular room
// - Test hypotheses to find paradoxes
// - Percent likelihood
// - Take the map into account, update which is next best guess to make
// - Take the map into account, who should I pull away from their goal
