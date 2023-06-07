import { pipe } from '@effect/data/Function';
import * as H from '@effect/data/Hash';
import * as HS from "@effect/data/HashSet";
import * as EQ from "@effect/data/Equal";
import * as ST from "@effect/data/Struct";
import * as ROA from "@effect/data/ReadonlyArray";
import * as S from '@effect/data/String';

/* CARD SETUP */

class Card<const CardType extends string, const CardLabel extends string> implements EQ.Equal {
    public static readonly _tag: unique symbol = Symbol("Card");

    public readonly cardType: CardType;
    public readonly label: CardLabel;

    constructor(cardType: CardType, label: CardLabel) {
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

type CompleteCardSet<const CardType extends string, const CardLabel extends string, const Annotation = never> = {
    // TODO figure out a way to ensure that Card<ct, CardLabel> has proper agreement
    //      (ex. you can't do Card<'weapon', 'dining room'>)
    [ct in CardType]: [Card<ct, CardLabel>, Annotation]
}

interface CardSetup<CardType extends string, CardLabel extends string> {
    readonly cards: HS.HashSet<Card<CardType, CardLabel>>;
}

const emptyCardSetup = (): CardSetup<never, never> => Object.freeze({
    cards: HS.empty(),
});

const standardNorthAmericanCardSetup = (): CardSetup<
    'person' | 'weapon' | 'room', 

    'scarlet' | 'mustard' | 'white' | 'green' | 'peacock' | 'plum' |
    'candlestick' | 'knife' | 'pipe' | 'revolver' | 'rope' | 'wrench' |
    'kitchen' | 'ballroom' | 'conservatory' | 'dining room' | 'billiard room' | 'library' | 'lounge' | 'hall' | 'study'
> => Object.freeze({
    cards: HS.fromIterable([
        new Card('person', 'scarlet'),
        new Card('person', 'mustard'),
        new Card('person', 'white'),
        new Card('person', 'green'),
        new Card('person', 'peacock'),
        new Card('person', 'plum'),

        new Card('weapon', 'candlestick'),
        new Card('weapon', 'knife'),
        new Card('weapon', 'pipe'),
        new Card('weapon', 'revolver'),
        new Card('weapon', 'rope'),
        new Card('weapon', 'wrench'),

        new Card('room', 'kitchen'),
        new Card('room', 'ballroom'),
        new Card('room', 'conservatory'),
        new Card('room', 'dining room'),
        new Card('room', 'billiard room'),
        new Card('room', 'library'),
        new Card('room', 'lounge'),
        new Card('room', 'hall'),
        new Card('room', 'study'),
    ])
});

const addCard = <const NewCardType extends string, const NewCardLabel extends string>(newCard: Card<NewCardType, NewCardLabel>) =>
                <const InitialCardType extends string, const InitialCardLabel extends string>(initialSetup: CardSetup<InitialCardType, InitialCardLabel>):
                CardSetup<InitialCardType | NewCardType, NewCardLabel | InitialCardLabel> =>
    ST.evolve(initialSetup, {
        cards: HS.add<Card<InitialCardType | NewCardType, NewCardLabel | InitialCardLabel>>(newCard)
    });

/* PLAYER SETUP */

class Player<const PlayerLabel extends string> implements EQ.Equal {
    public static readonly _tag: unique symbol = Symbol("Player");

    public readonly label: PlayerLabel;

    constructor(label: PlayerLabel) {
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

interface PlayerSetup<PlayerLabel extends string> {
    readonly players: HS.HashSet<Player<PlayerLabel>>
}

const emptyPlayerSetup = (): PlayerSetup<never> => Object.freeze({
    players: HS.empty(),
});

const addPlayer = <const NewPlayerLabel extends string>(player: Player<NewPlayerLabel>) =>
                  <const InitialPlayerLabel extends string>(initialSetup: PlayerSetup<InitialPlayerLabel>):
                  PlayerSetup<InitialPlayerLabel | NewPlayerLabel> =>
    ST.evolve(initialSetup, {
        players: HS.add<Player<InitialPlayerLabel | NewPlayerLabel>>(player)
    });

/** CARD DEALING */

// TODO add how many cards each player has

/* GUESSES */

class Guess<
    CardType extends string,
    CardLabel extends string,
    PlayerLabel extends string,
> {
    public static readonly _tag: unique symbol = Symbol("Guess");

    public readonly cards: CompleteCardSet<CardType, CardLabel>;
    public readonly guesser: Player<PlayerLabel>;
    public readonly nonRefuters: HS.HashSet<Player<PlayerLabel>>;
    public readonly refuter: Player<PlayerLabel> | never;
    public readonly refuteCard: CardLabel | never;

    constructor(
        cards: CompleteCardSet<CardType, CardLabel>,
        guesser: Player<PlayerLabel>,
        nonRefuters: HS.HashSet<Player<PlayerLabel>>,
        refuter: Player<PlayerLabel> | never,
        refuteCard: CardLabel | never,
    ) {
        this.cards = cards;
        this.guesser = guesser;
        this.nonRefuters = nonRefuters;
        this.refuter = refuter;
        this.refuteCard = refuteCard;
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

const addGuess = <
            // The types of cards and players from the game setup
            CardType extends string,
            CardLabel extends string,
            PlayerLabel extends string,

            // The cards guessed
            // this must be a complete set of cards of every type
            GuessCards extends CompleteCardSet<CardType, CardLabel>,

            // The player that made the guess
            // this is one of the full list players
            GuesserLabel extends PlayerLabel,

            // The player that refuted the guess
            // this is one of the full list of players, except the guesser
            // or it's nobody
            RefuterLabel extends Exclude<PlayerLabel, GuesserLabel>,

            // The players that did not refute the guess
            // this is one of the full list of players, except the guesser and refuter
            NonRefuterLabel extends Exclude<PlayerLabel, GuesserLabel | RefuterLabel>,

            // The card used to refute the guess
            // this is one of the full list of cards
            // or it's no card
            RefuteCardType extends (keyof GuessCards & CardType),
            RefuteCardLabel extends (GuessCards[RefuteCardType] & CardLabel),
        >({
            cards,
            guesser,
            nonRefuters,
            refuter,
            refuteCard,
        }: {
            cards: GuessCards,
            guesser: Player<GuesserLabel>,
            nonRefuters: HS.HashSet<Player<NonRefuterLabel>>,
            refuter: Player<RefuterLabel> | never,
            refuteCard: Card<RefuteCardType, RefuteCardLabel> | never,
        }): (
            (guesses: readonly Guess<
                CardType,
                CardLabel,
                PlayerLabel
            >[]) => Guess<
                CardType,
                CardLabel,
                PlayerLabel
            >[]) =>
    ROA.append(new Guess<CardType,  CardLabel, PlayerLabel>(
        cards,
        guesser,
        nonRefuters,
        refuter,
        refuteCard,
    ));

/* DEDUCTIONS */

interface Deduction<Conclusion> {
    // TODO conclusion levels: known, maybe, unknown
    conclusion: Conclusion;

    // TODO reason levels: observed (when?), inferred (how?)
    reasons: string[];
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
// - Who I've showed what
// - Best next guesses to make (not taking map into account)
// - Best next guesses to make (taking map into account)
// - Test hypotheses to find paradoxes
