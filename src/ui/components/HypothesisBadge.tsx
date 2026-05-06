import { Y } from "../../logic/Knowledge";
import type {
    HypothesisStatus,
    HypothesisValue,
} from "../../logic/Hypothesis";

// `data-glyph` discriminator constants hoisted to module scope so the
// `no-literal-string` lint rule reads them as code, not UI text. Tests
// assert on these too — keep them in sync.
const GLYPH_X = "x" as const;
const GLYPH_CHECK = "check" as const;
const GLYPH_QUESTION = "question" as const;

interface HypothesisBadgeProps {
    value: HypothesisValue;
    status: HypothesisStatus;
    /**
     * When `true`, a rejected badge (directlyContradicted /
     * jointlyConflicts) gets a `motion-safe:animate-pulse` to draw the
     * user's eye. Defaults to `false` so the badge is static
     * everywhere except where it's specifically meant to call for
     * attention (the cell, and the open popover — both can pulse at
     * the same time). The contradiction banner doesn't render the
     * badge at all today; the prop's `false` default is the future-
     * proof guard if that changes.
     */
    animated?: boolean;
}

// Tone and glyph reflect the resolved status:
//   - confirmed: tone = the (Y/N) hypothesis value's color, glyph = ✓.
//   - rejected (directlyContradicted / jointlyConflicts): tone = danger
//     red, glyph = X. Pulses with `motion-safe:animate-pulse` when
//     `animated` is true; static otherwise.
//   - active / off / derived: tone = the hypothesis value's color,
//     glyph = ?.
//
// Positioning is the caller's responsibility. The badge sits in the
// `topRight` slot of `CellLayout`, which handles corner placement and
// the `auto`-column mirror trick that keeps the central glyph centered.
export function HypothesisBadge({
    value,
    status,
    animated = false,
}: HypothesisBadgeProps) {
    const rejected =
        status.kind === "directlyContradicted" ||
        status.kind === "jointlyConflicts";
    const confirmed = status.kind === "confirmed";
    const tone = rejected ? "text-danger" : value === Y ? "text-yes" : "text-no";
    const glyphAttr = rejected
        ? GLYPH_X
        : confirmed
          ? GLYPH_CHECK
          : GLYPH_QUESTION;
    // `motion-safe:` so users with `prefers-reduced-motion: reduce`
    // see a static badge — same accessibility contract as the rest of
    // the app's `useReducedTransition` wrappers. Animation only applies
    // to rejected badges that are explicitly `animated`.
    const className =
        rejected && animated ? `${tone} motion-safe:animate-pulse` : tone;
    // ViewBox is "3 3 18 18" so the visible rounded square fills the
    // SVG's bounding box edge-to-edge. Without this, the rect at
    // (3,3) inside a "0 0 24 24" viewBox renders ~2px inside the SVG
    // box, leaving a phantom transparent border that makes the
    // badge sit visually further from the cell corner than the
    // footnote chip on the opposite side. Inner glyph coordinates
    // (?/check) stay at their original 24x24-relative positions
    // because the viewBox shift translates them — they still center
    // inside the rect.
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={14}
            height={14}
            viewBox="3 3 18 18"
            aria-hidden="true"
            focusable="false"
            data-glyph={glyphAttr}
            className={className}
        >
            <rect
                x="3"
                y="3"
                width="18"
                height="18"
                rx="3"
                fill="currentColor"
            />
            {rejected ? (
                <>
                    <line
                        x1="8"
                        y1="8"
                        x2="16"
                        y2="16"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                    />
                    <line
                        x1="16"
                        y1="8"
                        x2="8"
                        y2="16"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                    />
                </>
            ) : confirmed ? (
                <polyline
                    points="7 12 11 16 17 8"
                    fill="none"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            ) : (
                <>
                    <path
                        d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7"
                        fill="none"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                    <line
                        x1="12"
                        y1="17"
                        x2="12.01"
                        y2="17"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </>
            )}
        </svg>
    );
}
