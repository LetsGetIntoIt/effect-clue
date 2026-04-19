/**
 * Thin Clue-themed icon set, rendered as inline SVGs so there are no
 * build-time assets and `currentColor` inherits from parent text.
 *
 * Kept intentionally minimal — just the two decorative motifs we use
 * in the header and the case-file strip, plus the envelope glyph for
 * the share button (future). Prefer `aria-hidden` wrappers for purely
 * decorative uses; any icon that's the sole click target should pair
 * with an accessible label on its button parent.
 */

type IconProps = {
    readonly className?: string;
    readonly size?: number;
};

/**
 * Magnifying glass. Evokes the detective motif — used next to the
 * "Clue solver" title.
 */
export function MagnifyingGlass({ className, size = 24 }: IconProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
            className={className}
        >
            <circle cx="10" cy="10" r="6" />
            <line x1="14.5" y1="14.5" x2="20" y2="20" />
        </svg>
    );
}

/**
 * Envelope / dossier. Used next to the "Case file" bar in the
 * ChecklistGrid header.
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
