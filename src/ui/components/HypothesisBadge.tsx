import { Y } from "../../logic/Knowledge";
import type {
    HypothesisStatus,
    HypothesisValue,
} from "../../logic/Hypothesis";

interface HypothesisBadgeProps {
    value: HypothesisValue;
    status: HypothesisStatus;
}

// Tone reflects the HYPOTHESIS value, not the cell's displayed value:
// a cell that's been deduced Y but hypothesised N shows a red badge
// against a green cell, making the disagreement visible at a glance.
// Glyph reflects the resolved status — a check mark when the
// hypothesis has been confirmed by real facts, a question mark while
// it's still active, jointly conflicting, or directly contradicted.
//
// Positioning is the caller's responsibility. The badge sits in the
// `topRight` slot of `CellLayout`, which handles corner placement and
// the `auto`-column mirror trick that keeps the central glyph centered.
export function HypothesisBadge({ value, status }: HypothesisBadgeProps) {
    const tone = value === Y ? "text-yes" : "text-no";
    const confirmed = status.kind === "confirmed";
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
            data-glyph={confirmed ? "check" : "question"}
            className={tone}
        >
            <rect
                x="3"
                y="3"
                width="18"
                height="18"
                rx="3"
                fill="currentColor"
            />
            {confirmed ? (
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
