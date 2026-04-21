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
