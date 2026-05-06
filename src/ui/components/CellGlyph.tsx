import type { ReactNode } from "react";
import {
    type CellDisplay,
    type HypothesisStatus,
} from "../../logic/Hypothesis";
import { N, Y } from "../../logic/Knowledge";
import { AlertIcon } from "./Icons";

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
const GLYPH_ALERT = "alert" as const;
export const GLYPH_BLANK = "blank" as const;
type GlyphKind =
    | typeof GLYPH_YES
    | typeof GLYPH_NO
    | typeof GLYPH_QUESTION
    | typeof GLYPH_ALERT
    | typeof GLYPH_BLANK;

export const glyphKindFor = (
    display: CellDisplay,
    status: HypothesisStatus,
): GlyphKind => {
    // Contradicted hypotheses (directly or jointly) replace whatever
    // glyph would have rendered with the alert icon, so the conflict
    // reads at a glance.
    if (
        status.kind === "directlyContradicted" ||
        status.kind === "jointlyConflicts"
    ) {
        return GLYPH_ALERT;
    }
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
            return "✓";
        case GLYPH_NO:
            return "·";
        case GLYPH_QUESTION:
            return "?";
        case GLYPH_ALERT:
            return <AlertIcon size={14} className="text-danger" />;
        case GLYPH_BLANK:
            return null;
    }
};

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
    if (tone === Y) return "bg-yes-bg";
    if (tone === N) return "bg-no-bg";
    return "bg-white";
};
