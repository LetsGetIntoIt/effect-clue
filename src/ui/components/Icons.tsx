/**
 * Thin Clue-themed icon set, rendered as inline SVGs so there are no
 * build-time assets and `currentColor` inherits from parent text.
 *
 * Kept intentionally minimal — just the envelope glyph used next to
 * the Case-file progress strip. Prefer `aria-hidden` for purely
 * decorative uses; any icon that's the sole click target should pair
 * with an accessible label on its button parent.
 */

type IconProps = {
    readonly className?: string;
    readonly size?: number;
};

/**
 * Envelope / dossier. Used next to the "Case file" bar in the
 * Checklist's CaseFileHeader.
 */
export function Envelope({ className, size = 18 }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className={className}
        >
            <rect x="3" y="6" width="18" height="13" rx="1.5" />
            <path d="M3 7.5l9 6 9-6" />
        </svg>
    );
}

/** Trash can — paired with destructive remove actions. */
export function TrashIcon({ className, size = 18 }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className={className}
        >
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
    );
}

/** Close glyph for modal headers and dismiss buttons. */
export function XIcon({ className, size = 18 }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className={className}
        >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    );
}

/** Check mark — paired with successful inline confirmations. */
export function CheckIcon({ className, size = 18 }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className={className}
        >
            <polyline points="20 6 9 17 4 12" />
        </svg>
    );
}

/** Right-pointing arrow — paired with primary "get started" CTAs. */
export function ArrowRightIcon({ className, size = 18 }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className={className}
        >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="13 6 19 12 13 18" />
        </svg>
    );
}

/**
 * Curved arrow looping back to the left — paired with the Undo control.
 * Same 24×24 viewBox + currentColor stroke as the rest of the set so it
 * sits flush in the bottom-nav slots.
 */
export function UndoIcon({ className, size = 20 }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className={className}
        >
            <polyline points="9 14 4 9 9 4" />
            <path d="M4 9h9a7 7 0 0 1 0 14h-3" />
        </svg>
    );
}

/** Mirror of {@link UndoIcon} — paired with the Redo control. */
export function RedoIcon({ className, size = 20 }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className={className}
        >
            <polyline points="15 14 20 9 15 4" />
            <path d="M20 9h-9a7 7 0 0 0 0 14h3" />
        </svg>
    );
}

/** Magnifying glass — paired with search / filter controls. */
export function SearchIcon({ className, size = 14 }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className={className}
        >
            <circle cx="11" cy="11" r="7" />
            <line x1="20" y1="20" x2="16" y2="16" />
        </svg>
    );
}

/** User silhouette — paired with account / sign-in affordances. */
export function UserIcon({ className, size = 18 }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className={className}
        >
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
    );
}


/**
 * Filled triangle with an exclamation mark — used to flag a hypothesis
 * cell whose state is contradicted (either directly by a real fact, or
 * jointly by another hypothesis). `currentColor` lets the parent style
 * the tone (typically `text-danger`).
 */
export function AlertIcon({ className, size = 14 }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className={className}
        >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
    );
}

/**
 * Solid rounded square with a "?" cut into it — used as a small
 * corner badge on checklist cells the user has pinned a hypothesis
 * on. The fill is `currentColor` so the parent's `text-*` class
 * picks the tone (typically `text-yes` or `text-no` matching the
 * hypothesis value). The inner "?" strokes in white so it stays
 * legible regardless of fill colour.
 */
export function BoxedQuestionMarkIcon({ className, size = 12 }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
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
        </svg>
    );
}

/** Arrow leaving a frame — paired with links that open in a new tab. */
export function ExternalLinkIcon({ className, size = 14 }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className={className}
        >
            <path d="M14 4h6v6" />
            <path d="M10 14L20 4" />
            <path d="M19 13v6a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V7a1.5 1.5 0 0 1 1.5-1.5H11" />
        </svg>
    );
}
