
/**
 * The different types of cards the game supports
 * Ex. Person, Place, Weapon
 */
interface CardType {
    readonly tag: 'CardType';
    readonly id:  symbol;
    readonly label: string;
}

/**
 * A card representing one possibility for a {@link CardType}
 * Ex. Colonel Mustard, Wrench, Ball Room
 */
interface Card {
    readonly tag: 'Card';
    readonly id:  symbol;

    readonly type: CardType;
    readonly label: string;
}

/**
 * A human player
 */
interface Player {
    readonly tag: 'Player';
    readonly id:  symbol;
    readonly label: string;
}

/**
 * The case that was selected
 */
interface CaseFile {
    readonly tag: 'CaseFile';
    readonly id:  symbol;

    readonly type: CardType;
    readonly label: string;
}

type CardHolder = Player | CaseFile;

type Truthiness = 'yes' | 'no' | 'unknown';

interface Knowledge {
    readonly tag: 'Knowledge';
    readonly id: symbol;
}

interface Guess {
    readonly tag: 'Guess';
    readonly id: symbol;
    
    readonly cards: Map<CardType, Card>;
    readonly 
}

/**
 * Actual logic
 */

/**
 * Initialize a new knowledge base that knows nothing
 */
const noKnowledge = (): Knowledge => null;

const setHasCard = (knowledge: Knowledge) => (holder: CardHolder, card: Card): Knowledge => null;
const addGuess = (knowledge: Knowledge) => (guesser: Player, )