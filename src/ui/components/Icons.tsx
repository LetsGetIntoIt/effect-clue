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
