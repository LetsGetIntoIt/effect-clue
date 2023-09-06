import { Data, HashMap, Struct, pipe } from "effect";
import { Card, Player } from "./GameObjects";

export const ChecklistValue = (value: "Y" | "N"): "Y" | "N" => value;

export type Knowledge = Data.Data<{
    playerChecklist: HashMap.HashMap<
        Data.Data<[Player, Card]>,
        "Y" | "N"
    >;

    caseFileChecklist: HashMap.HashMap<Card, "Y" | "N">;

    playerHandSize: HashMap.HashMap<Player, number>;
}>;

export const updateKnowledge = (
    knowledge: Knowledge,
    transforms: Partial<{
        [prop in keyof Knowledge]: (value: Knowledge[prop]) => Knowledge[prop]
    }>
): Knowledge => pipe(
    knowledge,
    Struct.evolve(transforms),
    Data.struct,
);
