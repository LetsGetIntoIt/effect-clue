import { Brand, Data } from "effect";

/**
 * A player in a Clue game, identified by name. We use a branded string so
 * that callers can't accidentally pass a raw string where a Player is
 * expected, but the set of valid player names is data rather than part of
 * the type system — this is what unlocks variable player counts and custom
 * names.
 */
export type Player = Brand.Branded<string, "Player">;
export const Player = Brand.nominal<Player>();

/**
 * A card — a suspect, weapon, or room. Also a branded string for the same
 * reason as Player.
 */
export type Card = Brand.Branded<string, "Card">;
export const Card = Brand.nominal<Card>();

/**
 * A card category name (e.g. "Suspects", "Weapons", "Rooms", or anything
 * the user defines). The case file contains exactly one card per category.
 *
 * We brand instead of using a string literal union because the categories
 * themselves are data-driven: presets ship with suspects/weapons/rooms, but
 * users can add, rename, or remove categories. The actual list of
 * categories in play lives on the `GameSetup`.
 */
export type CardCategory = Brand.Branded<string, "CardCategory">;
export const CardCategory = Brand.nominal<CardCategory>();

/**
 * Who owns a given card — either a player or the "case file" (the envelope
 * containing the solution). Modelling the case file as just another kind of
 * owner lets us reuse a single constraint-propagation combinator for both
 * "each card has exactly one owner" and "the case file owns exactly one of
 * each category" rules.
 */
export type Owner = Data.Data<
    | { readonly _tag: "Player"; readonly player: Player }
    | { readonly _tag: "CaseFile" }
>;

export const PlayerOwner = (player: Player): Owner =>
    Data.struct({ _tag: "Player" as const, player });

export const CaseFileOwner = (): Owner =>
    Data.struct({ _tag: "CaseFile" as const });

export const ownerLabel = (owner: Owner): string =>
    owner._tag === "Player" ? owner.player : "Case file";

export const isCaseFile = (owner: Owner): boolean =>
    owner._tag === "CaseFile";

export const isPlayer = (owner: Owner): boolean =>
    owner._tag === "Player";
