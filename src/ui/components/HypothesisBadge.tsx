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
export function HypothesisBadge({ value, status }: HypothesisBadgeProps) {
    const tone = value === Y ? "text-yes" : "text-no";
    const confirmed = status.kind === "confirmed";
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={14}
            height={14}
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
            data-glyph={confirmed ? "check" : "question"}
            className={`absolute right-0.5 top-0.5 ${tone}`}
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
