import { Card, CardCategory, Player } from "./GameObjects";

/**
 * Structured identity of which rule raised a Contradiction. The UI uses
 * this to render an explanation that names the rule that fired (e.g.
 * "Player passed on this suggestion, so they can't have …") rather than
 * just the cell-level conflict the rule eventually tripped over.
 *
 * - `DirectCell`: setCell raised the conflict without any rule context
 *   wrapping it (e.g. two raw known-card inputs collide). The UI falls
 *   back to a generic "X is already known to have Y" sentence.
 * - `NonRefuters` / `RefuterShowed` / `RefuterOwnsOneOf`: the
 *   suggestion-driven rule wrapped a cell-conflict to attach the index
 *   of the suggestion that triggered it.
 * - `SliceCardOwnership` / `SlicePlayerHand` / `SliceCaseFileCategory`:
 *   `applySlice` itself over- or under-saturated. `direction` is `over`
 *   when there are too many Ys and `under` when there are too many Ns.
 *
 * Lives in its own module to break a circular import: Knowledge.ts
 * (where Contradiction lives) is upstream of Provenance.ts (where the
 * structurally-similar ReasonKind lives), so Knowledge.ts can't reach
 * for ReasonKind directly.
 */
export type ContradictionKind =
    | { readonly _tag: "DirectCell" }
    | { readonly _tag: "NonRefuters"; readonly suggestionIndex: number }
    | { readonly _tag: "RefuterShowed"; readonly suggestionIndex: number }
    | { readonly _tag: "RefuterOwnsOneOf"; readonly suggestionIndex: number }
    | {
          readonly _tag: "SliceCardOwnership";
          readonly card: Card;
          readonly direction: "over" | "under";
      }
    | {
          readonly _tag: "SlicePlayerHand";
          readonly player: Player;
          readonly handSize: number;
          readonly direction: "over" | "under";
      }
    | {
          readonly _tag: "SliceCaseFileCategory";
          readonly category: CardCategory;
          readonly direction: "over" | "under";
      };
