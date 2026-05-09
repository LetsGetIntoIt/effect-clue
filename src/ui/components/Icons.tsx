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

/** Pencil — paired with rename / edit actions. */
export function PencilIcon({ className, size = 14 }: IconProps) {
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
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />
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

/**
 * Triangular warning / alert glyph — used wherever the UI flags a
 * problem the user needs to attend to (contradictions, validation
 * errors, conflicts). NOT for non-destructive close — that's `XIcon`.
 * NOT for the N value of a checklist cell — that's also `XIcon`.
 */
export function AlertIcon({ className, size = 18 }: IconProps) {
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

/** Clipboard — paired with copy-to-clipboard affordances. */
export function ClipboardIcon({ className, size = 14 }: IconProps) {
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
            <rect x="8" y="2" width="8" height="4" rx="1" />
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
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
 * Lightbulb — paired with the per-cell "candidate for suggestion N"
 * footnote affordance so the same glyph appears in the cell chip and
 * the why-popover explanation, tying them together visually.
 */
export function LightbulbIcon({ className, size = 14 }: IconProps) {
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
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M15.09 14a5 5 0 1 0-6.18 0c.55.45 1.09 1.21 1.09 2v2h4v-2c0-.79.54-1.55 1.09-2z" />
        </svg>
    );
}

/**
 * Three stacked rectangles — a deck of cards. Used in the account
 * modal's "My card packs" list to indicate a pack is fully synced.
 */
export function CardStackIcon({ className, size = 14 }: IconProps) {
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
            <rect x="7" y="9" width="13" height="12" rx="1.5" />
            <path d="M5 7h13" />
            <path d="M3 5h13" />
        </svg>
    );
}

/**
 * Two curved arrows forming a circle — the standard refresh / sync
 * glyph. Used in the account modal to indicate a pack has pending
 * changes (and, with `animate-spin`, that a sync is in progress).
 */
export function RefreshIcon({ className, size = 14 }: IconProps) {
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
            <polyline points="20 4 20 10 14 10" />
            <polyline points="4 20 4 14 10 14" />
            <path d="M20 10a8 8 0 0 0-14.93-2" />
            <path d="M4 14a8 8 0 0 0 14.93 2" />
        </svg>
    );
}

/** Left-pointing chevron — paired with "move left" controls. */
export function ChevronLeftIcon({ className, size = 16 }: IconProps) {
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
            <polyline points="15 6 9 12 15 18" />
        </svg>
    );
}

/** Right-pointing chevron — paired with "move right" controls. */
export function ChevronRightIcon({ className, size = 16 }: IconProps) {
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
            <polyline points="9 6 15 12 9 18" />
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
