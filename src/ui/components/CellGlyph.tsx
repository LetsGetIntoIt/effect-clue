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
/** Background + text color for an N-toned surface. */
export const CELL_TONE_N_CLASS = "bg-no-bg text-no";
/** Background + text color for a no-value (blank / unknown) surface. */
export const CELL_TONE_NEUTRAL_CLASS = "bg-white";

/** Single-pixel border using the same neutral color as the live grid. */
const CELL_BORDER_CLASS = "border border-border";

/**
 * Pixel size for the inline cell-glyph icons. Matches `text-[12px]
 * font-semibold` cap-height closely so the chip reads as letter-sized.
 */
const CELL_ICON_SIZE = 14;

const cellToneClassForValue = (
    value: CellValue,
): typeof CELL_TONE_Y_CLASS | typeof CELL_TONE_N_CLASS =>
    value === Y ? CELL_TONE_Y_CLASS : CELL_TONE_N_CLASS;

// Discriminator constants for the cell's primary glyph slot. Module-
// scope so the `no-literal-string` lint rule reads them as code, not
// UI text. The matching presentation lives in `renderGlyphNode`.
//
// Direct-hypothesis cells use the same "?" glyph as derived cells —
// the visual distinction lives in a separate corner badge.
//
// Only `GLYPH_BLANK` is exported because callers need it to short-
// circuit "render nothing" branches; the rest are internal — the
// helpers below take and return them through the `GlyphKind` type
// alone, keeping the public surface narrow.
const GLYPH_YES = "yes" as const;
const GLYPH_NO = "no" as const;
const GLYPH_QUESTION = "question" as const;
export const GLYPH_BLANK = "blank" as const;
type GlyphKind =
    | typeof GLYPH_YES
    | typeof GLYPH_NO
    | typeof GLYPH_QUESTION
    | typeof GLYPH_BLANK;

// Rejected hypotheses (directly contradicted or jointly conflicting)
// no longer override the center glyph — the cell keeps showing its
// real-only deduced value, and the corner `HypothesisBadge` carries
// the X icon + bounce animation that flags the conflict.
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
            return GLYPH_QUESTION;
        case "blank":
            return GLYPH_BLANK;
    }
};

export const renderGlyphNode = (kind: GlyphKind): ReactNode => {
    switch (kind) {
        case GLYPH_YES:
            return <CheckIcon size={CELL_ICON_SIZE} />;
        case GLYPH_NO:
            return <XIcon size={CELL_ICON_SIZE} />;
        case GLYPH_QUESTION:
            return "?";
        case GLYPH_BLANK:
            return null;
    }
};

/**
 * Pick the icon for a Y or N value. The cell glyph and the popover
 * toggle's chip both call through here so they always agree on which
 * icon represents which value.
 */
const cellGlyphIcon = (value: CellValue): ReactNode =>
    value === Y ? (
        <CheckIcon size={CELL_ICON_SIZE} />
    ) : (
        <XIcon size={CELL_ICON_SIZE} />
    );

// Tone class for any container that should match a cell's background
// (the live cell, the popover's mini-glyph box). Mirrors the tone
// branch in `cellClass`: real/hypothesis/derived all paint Y green,
// N red, anything else white.
export const cellToneBgClass = (display: CellDisplay): string => {
    const tone =
        display.tag === "real"
            ? display.value
            : display.tag === "hypothesis"
              ? display.value
              : display.tag === "derived"
                ? display.value
                : undefined;
    if (tone === Y) return CELL_TONE_Y_CLASS.split(" ")[0]!;
    if (tone === N) return CELL_TONE_N_CLASS.split(" ")[0]!;
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
 */
export function ProseChecklistIcon({
    value,
    className,
}: {
    readonly value: CellValue;
    readonly className?: string;
}) {
    return (
        <span
            aria-hidden
            className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center ${CELL_BORDER_CLASS} text-[12px] font-semibold leading-none ${cellToneClassForValue(value)} ${className ?? ""}`}
        >
            {cellGlyphIcon(value)}
        </span>
    );
}
