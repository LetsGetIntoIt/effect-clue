import { Data, HashSet } from "effect";
import { Player, Card } from "./GameObjects";

export type Suggestion = Data.Data<{
    suggester: Player;
    cards: HashSet.HashSet<Card>;
    nonRefuters: HashSet.HashSet<Player>;
    refuter: Player | undefined;
    seenCard: Card | undefined;
}>;
