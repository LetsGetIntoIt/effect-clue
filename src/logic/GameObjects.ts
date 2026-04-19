import { Brand, Data, Match } from "effect";

/**
 * A player in a Clue game, identified by name. We use a branded string so
 * that callers can't accidentally pass a raw string where a Player is
 * expected, but the set of valid player names is data rather than part of
 * the type system — this is what unlocks variable player counts and custom
 * names.
 *
 * Players are identified by their display name (no separate id). Since
 * renaming a player requires touching only a handful of references (no
 * HashSet<Player> in suggestions, etc. — they already fan out through the
 * reducer), the id/name split would cost more than it saves.
 */
export type Player = Brand.Branded<string, "Player">;
export const Player = Brand.nominal<Player>();

/**
 * A card's stable identity. This is an *opaque id* — not the display
 * name. Card names can be edited by the user at any time, so we can't
 * use the name as the identity (suggestions, hand tracking, provenance,
 * and footnotes all reference cards; a rename mid-game would orphan all
 * those references).
 *
 * The display name lives on the `GameSetup.categories[].cards[]` entries
 * as a separate `name` field. Use `cardName(setup, id)` or `findCardEntry`
 * from GameSetup.ts to look up the name for rendering.
 *
 * We still brand the string so stray strings can't be passed where an id
 * is expected. Preset IDs are human-readable (e.g. `card-miss-scarlet`)
 * for debuggability, but they're treated opaquely by the solver.
 */
export type Card = Brand.Branded<string, "Card">;
export const Card = Brand.nominal<Card>();

/**
 * Same idea for categories — an opaque, stable id with display name
 * living on `GameSetup.categories[].name`.
 */
export type CardCategory = Brand.Branded<string, "CardCategory">;
export const CardCategory = Brand.nominal<CardCategory>();

/**
 * Generate a fresh opaque id for a card. Uses `crypto.randomUUID()` where
 * available, falling back to timestamp+random in ancient runtimes.
 */
const randomId = (): string => {
    if (
        typeof globalThis !== "undefined" &&
        typeof globalThis.crypto !== "undefined" &&
        typeof globalThis.crypto.randomUUID === "function"
    ) {
        return globalThis.crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
};

export const newCardId = (): Card => Card(`card-${randomId()}`);
export const newCategoryId = (): CardCategory =>
    CardCategory(`category-${randomId()}`);

/**
 * Who owns a given card — either a player or the "case file" (the envelope
 * containing the solution). Modelling the case file as just another kind of
 * owner lets us reuse a single constraint-propagation combinator for both
 * "each card has exactly one owner" and "the case file owns exactly one of
 * each category" rules.
 *
 * Each variant is a `Data.TaggedClass` — structural `Equal` / `Hash`, a
 * runtime `_tag` ("Player" / "CaseFile") that `Match.tag` / `Match.tags`
 * narrow on, and extension-friendly if we later want to hang methods on
 * the class. The `PlayerOwner(player)` / `CaseFileOwner()` factory
 * helpers preserve the existing call-site ergonomics (136 callers) so
 * this change is a pure internals swap.
 */
class PlayerOwnerImpl extends Data.TaggedClass("Player")<{
    readonly player: Player;
}> {}

class CaseFileOwnerImpl extends Data.TaggedClass("CaseFile")<{}> {}

export type Owner = PlayerOwnerImpl | CaseFileOwnerImpl;

export const PlayerOwner = (player: Player): Owner =>
    new PlayerOwnerImpl({ player });

export const CaseFileOwner = (): Owner => new CaseFileOwnerImpl();

export const ownerLabel = (owner: Owner): string =>
    Match.value(owner).pipe(
        Match.tagsExhaustive({
            Player: ({ player }) => String(player),
            CaseFile: () => "Case file",
        }),
    );
