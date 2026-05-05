import type { ReactNode } from "react";

interface CellLayoutProps {
    /**
     * Indicator pinned to the cell's top-left corner. Rendered visibly
     * in column 1 and invisibly mirrored into column 3 so the side
     * columns end up the same width — that symmetry keeps the centered
     * content at the cell's true horizontal midpoint regardless of
     * which corner is wider.
     */
    readonly topLeft?: ReactNode;
    /**
     * Indicator pinned to the cell's top-right corner. Same mirroring
     * rule as {@link topLeft}, in the opposite direction.
     */
    readonly topRight?: ReactNode;
    /**
     * Centered content (glyph, checkbox, etc). Sits in the middle
     * column, centered both horizontally (within the column) and
     * vertically (within the cell's full height).
     */
    readonly center?: ReactNode;
}

/**
 * Three-slot layout for a checklist cell: top-left and top-right corner
 * indicators flanking a centered piece of content. Content-agnostic —
 * callers pass whatever React nodes belong in each slot.
 *
 * Grid layout:
 * - 3 columns `1fr | auto | 1fr`. Each visible corner indicator is
 *   paired with an invisibly mirrored copy in the opposite column so
 *   both side columns floor to `max(topLeft_w, topRight_w)`; the 1fr
 *   distribution then keeps them equal width even when the cell is
 *   forced wider by sibling cells in the same table column. That
 *   symmetry pins the centered content to the cell's true horizontal
 *   midpoint regardless of how many digits a corner indicator carries.
 * - 2 rows `auto | 1fr`. Row 1 sizes to the corner indicators and sits
 *   at the cell's top edge; row 2 absorbs the remaining height. The
 *   centered content spans both rows with `place-self-center` so it
 *   lands at the cell's vertical center.
 *
 * No `gap` between tracks — the centered content sits flush against
 * its column boundaries so the cell is no wider than the indicators
 * + center actually require. The 2px corner inset comes from the
 * grid container's padding.
 */
export function CellLayout({ topLeft, topRight, center }: CellLayoutProps) {
    return (
        // `min-h-9` forces the grid to be at least 36px tall and the
        // table row honors that as its actual row height — so the
        // grid's `1fr` row can fill the slack below the corner badges
        // and the centered content (spanning both rows) lands at the
        // cell's true vertical midpoint. We can't rely on `h-full`
        // here because table-cell layout treats `height: 100%` on a
        // td as a min-height per CSS spec, and the descendants'
        // percentage heights collapse to their content size.
        <div className="mx-auto grid h-full min-h-9 min-w-9 grid-cols-[minmax(auto,1fr)_auto_minmax(auto,1fr)] grid-rows-[auto_1fr] p-[2px]">
            {topLeft != null && (
                <div className="col-start-1 row-start-1 flex self-start justify-self-start">
                    {topLeft}
                </div>
            )}
            {topRight != null && (
                <div
                    aria-hidden
                    className="invisible col-start-1 row-start-1 flex self-start justify-self-start"
                >
                    {topRight}
                </div>
            )}
            {center != null && (
                <div className="col-start-2 row-span-2 row-start-1 flex place-self-center items-center justify-center">
                    {center}
                </div>
            )}
            {topLeft != null && (
                <div
                    aria-hidden
                    className="invisible col-start-3 row-start-1 flex self-start justify-self-end"
                >
                    {topLeft}
                </div>
            )}
            {topRight != null && (
                <div className="col-start-3 row-start-1 flex self-start justify-self-end">
                    {topRight}
                </div>
            )}
        </div>
    );
}
