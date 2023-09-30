import { Data, HashMap, HashSet, Struct, pipe } from "effect";
import { Card, Player } from "./GameObjects";
import { Suggestion } from "./Suggestion";

export const ChecklistValue = (value: "Y" | "N"): "Y" | "N" => value;

export type Knowledge = Data.Data<{
    playerChecklist: HashMap.HashMap<
        Data.Data<[Player, Card]>,
        "Y" | "N"
    >;

    caseFileChecklist: HashMap.HashMap<Card, "Y" | "N">;

    playerHandSize: HashMap.HashMap<Player, number>;

    suggestions: HashSet.HashSet<Suggestion>,
}>;

export const empty: Knowledge = Data.struct({
    playerChecklist: HashMap.empty(),
    caseFileChecklist: HashMap.empty(),
    playerHandSize: HashMap.empty(),
    suggestions: HashSet.empty(),
});

export const updatePlayerChecklist = (
    key: Data.Data<[Player, Card]>,
    value: "Y" | "N",
) => (
    knowledge: Knowledge,
): Knowledge => pipe(
    knowledge,
    Struct.evolve({
        playerChecklist: HashMap.set(key, value),
    }),
    Data.struct,
);

export const updateCaseFileChecklist = (
    key: Card,
    value: "Y" | "N",
) => (
    knowledge: Knowledge,
): Knowledge => pipe(
    knowledge,
    Struct.evolve({
        caseFileChecklist: HashMap.set(key, value),
    }),
    Data.struct,
);

export const updatePlayerHandSize = (
    key: Player,
    value: number,
) => (
    knowledge: Knowledge,
): Knowledge => pipe(
    knowledge,
    Struct.evolve({
        playerHandSize: HashMap.set(key, value),
    }),
    Data.struct,
);

export const updateSuggestions = (
    suggestion: Suggestion,
) => (
    knowledge: Knowledge,
): Knowledge => pipe(
    knowledge,
    Struct.evolve({
        suggestions: HashSet.add(suggestion),
    }),
    Data.struct,
);
