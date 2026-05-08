import type { ReactNode } from "react";
import {
    type CellDisplay,
    type HypothesisStatus,
} from "../../logic/Hypothesis";
import { N, Y, type CellValue } from "../../logic/Knowledge";
import { CheckIcon, XIcon } from "./Icons";

// ---------------------------------------------------------------------------
// Shared cell styling.
//
// One source of truth for "what does a Y / N / blank cell look like" so the
// live grid (`Checklist.tsx`'s `cellClass`), the popover's mini-cell
// (`CellWhyPopover.tsx`), and the popover toggle (`HypothesisControl.tsx`)
// all match without copy-pasted Tailwind strings drifting apart.
// ---------------------------------------------------------------------------

/** Background + text color for a Y-toned surface. */
export const CELL_TONE_Y_CLASS = "bg-yes-bg text-yes";
/**
 * Background + text color for an N-toned surface in prose contexts
 * (popover chips, contradiction banners). The live grid uses the
 * lighter `text-no-cell` instead — see the override in
 * `Checklist.cellClass` for the rationale.
 */
const CELL_TONE_N_CLASS = "bg-no-bg text-no";
/** Background + text color for a no-value (blank / unknown) surface. */
export const CELL_TONE_NEUTRAL_CLASS = "bg-white";

/** Single-pixel border using the same neutral color as the live grid. */
const CELL_BORDER_CLASS = "border border-border";

/**
 * Pixel size for the inline cell-glyph icons rendered inside the live
 * grid (where each cell has a fixed pixel layout). Prose chips size
 * the icon via CSS instead so the chip scales with surrounding text.
 */
const CELL_ICON_SIZE_PX = 14;

const cellToneClassForValue = (
    value: CellValue,
): typeof CELL_TONE_Y_CLASS | typeof CELL_TONE_N_CLASS =>
    value === Y ? CELL_TONE_Y_CLASS : CELL_TONE_N_CLASS;

// Discriminator constants for the cell's primary glyph slot. Module-
// scope so the `no-literal-string` lint rule reads them as code, not
// UI text. The matching presentation lives in `renderGlyphNode`.
//
// Hypothesis-tagged and derived cells render the same Y/N icon a
// real cell would — but wrapped in parentheses, so the user can tell
// at a glance "this value isn't real, it depends on a hypothesis."
// The tone (green/red) is the same; the parens carry the
// "hypothetical" semantics that a bare "?" used to.
//
// Only `GLYPH_BLANK` is exported because callers need it to short-
// circuit "render nothing" branches; the rest are internal — the
// helpers below take and return them through the `GlyphKind` type
// alone, keeping the public surface narrow.
const GLYPH_YES = "yes" as const;
const GLYPH_NO = "no" as const;
const GLYPH_DERIVED_YES = "derivedYes" as const;
const GLYPH_DERIVED_NO = "derivedNo" as const;
export const GLYPH_BLANK = "blank" as const;
type GlyphKind =
    | typeof GLYPH_YES
    | typeof GLYPH_NO
    | typeof GLYPH_DERIVED_YES
    | typeof GLYPH_DERIVED_NO
    | typeof GLYPH_BLANK;

// Rejected hypotheses (directly contradicted or jointly conflicting)
// no longer override the center glyph — the cell keeps showing its
// real-only deduced value, and the popover's status box carries the
// alert icon + pulse animation that flags the conflict.
//
// Hypothesis-tagged and derived cells share the parens-wrapped
// rendering: `(✓)` / `(✗)`. Tone still tracks the value (green for Y,
// red for N) — the parens are the visible "this is hypothetical, not
// real" cue, replacing the old `?` glyph that left the user
// guessing at color alone to read which side of Y/N the cell was on.
export const glyphKindFor = (
    display: CellDisplay,
    _status: HypothesisStatus,
): GlyphKind => {
    switch (display.tag) {
        case "real":
            if (display.value === Y) return GLYPH_YES;
            if (display.value === N) return GLYPH_NO;
            return GLYPH_BLANK;
        case "hypothesis":
        case "derived":
            return display.value === Y ? GLYPH_DERIVED_YES : GLYPH_DERIVED_NO;
        case "blank":
            return GLYPH_BLANK;
    }
};

/**
 * `compact: true` renders the parens-wrapped variants at a smaller
 * size — just enough to fit inside a 20px-wide chip box (the popover's
 * deduction-section mini-cell). The default leaves the parens variant
 * at the full cell-icon size so the live grid looks consistent with
 * its bare counterparts.
 */
export const renderGlyphNode = (
    kind: GlyphKind,
    opts: { readonly compact?: boolean } = {},
): ReactNode => {
    const compact = opts.compact ?? false;
    switch (kind) {
        case GLYPH_YES:
            return <CheckIcon size={CELL_ICON_SIZE_PX} />;
        case GLYPH_NO:
            return <XIcon size={CELL_ICON_SIZE_PX} />;
        case GLYPH_DERIVED_YES:
            return compact ? (
                <span className="inline-flex items-center text-[10px] leading-none">
                    (<CheckIcon size={10} />)
                </span>
            ) : (
                <span className="inline-flex items-center">
                    (<CheckIcon size={CELL_ICON_SIZE_PX} />)
                </span>
            );
        case GLYPH_DERIVED_NO:
            return compact ? (
                <span className="inline-flex items-center text-[10px] leading-none">
                    (<XIcon size={10} />)
                </span>
            ) : (
                <span className="inline-flex items-center">
                    (<XIcon size={CELL_ICON_SIZE_PX} />)
                </span>
            );
        case GLYPH_BLANK:
            return null;
    }
};

/**
 * Pick the icon for a Y or N value, sized to fill its parent box (so
 * the prose chip can scale with text via em units; the parent
 * controls dimensions).
 */
const cellGlyphIcon = (value: CellValue, iconClass: string): ReactNode =>
    value === Y ? (
        <CheckIcon className={iconClass} />
    ) : (
        <XIcon className={iconClass} />
    );

// Tone class for any container that should match a cell's appearance
// — same bg AND text color the live grid uses. Mirrors `cellClass`'s
// branch: real/hypothesis/derived all paint Y green, N red, anything
// else neutral white. The text color matters because inner glyph
// SVGs use `currentColor`; without it the icon inherits the
// surrounding `text-fg` and reads dark/black instead of tone-red /
// tone-green.
export const cellToneClass = (display: CellDisplay): string => {
    const tone =
        display.tag === "real"
            ? display.value
            : display.tag === "hypothesis"
              ? display.value
              : display.tag === "derived"
                ? display.value
                : undefined;
    if (tone === Y) return CELL_TONE_Y_CLASS;
    if (tone === N) return CELL_TONE_N_CLASS;
    return CELL_TONE_NEUTRAL_CLASS;
};

/**
 * Inline chip that mirrors a checklist cell's appearance — same border,
 * background, and text color — for prose contexts that mention a Y/N
 * value (popover help text, contradiction banners, anywhere a "this is
 * Y" / "this is N" reference would otherwise be a bare letter).
 *
 * The chip is decorative; assistive tech consumes the surrounding text
 * (e.g. "Hypothesis: Y — plausible so far"), so the chip is
 * `aria-hidden`. Callers wanting screen-reader text should keep the
 * value name elsewhere in the sentence.
 *
 * Two orthogonal "this isn't a real fact" cues, distinguishing the
 * cell's relationship to a hypothesis:
 *
 * - `isHypothesis` is for cells the user has DIRECTLY hypothesized
 *   on. The chip swaps the icon for a "?" (still on the value's
 *   tone) — same convention as before the parens reframe.
 *
 * - `isHypothesisDependent` is for cells whose value follows from a
 *   hypothesis on another cell. The chip keeps its icon but wraps it
 *   in parentheses — `(✓)` / `(✗)` — making the "derived from a
 *   hypothesis" relationship visible without losing the value.
 *
 * Mutually exclusive at the call site. If both are passed,
 * `isHypothesis` wins (a directly-hypothesized cell is a special
 * case of the more general "depends on a hypothesis" relationship,
 * but it deserves the more emphatic "?" cue).
 *
 * `invertedStyle` swaps the chip from "light tone bg + dark glyph"
 * (the cell-grid look) to "dark tone bg + light glyph" — the right
 * variant when the chip needs to stand OUT against the cell's own
 * tone-tinted background, e.g. the cell's top-right hypothesis badge
 * sitting on a `bg-yes-bg` cell, or the matching standalone badge
 * inside the popover that pairs with it. Inverted chips drop the
 * border because the dark fill already separates them from the
 * surrounding surface.
 */
const CELL_TONE_INVERTED_Y_CLASS = "bg-yes text-white";
const CELL_TONE_INVERTED_N_CLASS = "bg-no text-white";

const invertedToneClassForValue = (
    value: CellValue,
): typeof CELL_TONE_INVERTED_Y_CLASS | typeof CELL_TONE_INVERTED_N_CLASS =>
    value === Y ? CELL_TONE_INVERTED_Y_CLASS : CELL_TONE_INVERTED_N_CLASS;

export function ProseChecklistIcon({
    value,
    isHypothesis = false,
    isHypothesisDependent = false,
    invertedStyle = false,
    className,
}: {
    readonly value: CellValue;
    readonly isHypothesis?: boolean;
    readonly isHypothesisDependent?: boolean;
    readonly invertedStyle?: boolean;
    readonly className?: string;
}) {
    // Sized in em — the chip's box, its border-radius via the
    // existing cell shape, and its inner glyph all scale with the
    // parent's font-size. So the chip is approximately the size of a
    // capital letter beside it, and a user who bumps their browser
    // font size sees the chip grow proportionally. The icon fills
    // ~70% of the chip via `h-[0.7em] w-[0.7em]` so its stroke
    // weight reads at the same density as a glyph in the surrounding
    // text.
    //
    // `mx-px` is a 1px horizontal gap — when the chip lands inline
    // inside prose ("Hypothesis: <chip> — confirmed.") it reads as
    // a separate token rather than being glued to neighbouring
    // letters.
    const toneClass = invertedStyle
        ? invertedToneClassForValue(value)
        : cellToneClassForValue(value);
    const borderClass = invertedStyle ? "" : CELL_BORDER_CLASS;
    const innerGlyph = isHypothesis ? (
        "?"
    ) : isHypothesisDependent ? (
        // Parens + icon need to fit a chip box that's only ~1.1em
        // wide. Shrink the inner content so the closing `)` doesn't
        // clip past the chip's right edge: scale parens down to
        // 0.7em (relative to the chip's font-size), and the icon
        // scales with the inner span via `h-[1em] w-[1em]` (ending
        // up ~70% of a default-sized icon).
        <span className="inline-flex items-center leading-none text-[0.7em]">
            ({cellGlyphIcon(value, "h-[1em] w-[1em]")})
        </span>
    ) : (
        cellGlyphIcon(value, "h-[0.7em] w-[0.7em]")
    );
    return (
        <span
            aria-hidden
            className={`mx-px inline-flex h-[1.1em] w-[1.1em] flex-shrink-0 items-center justify-center ${borderClass} font-semibold leading-none ${toneClass} ${className ?? ""}`}
        >
            {innerGlyph}
        </span>
    );
}
