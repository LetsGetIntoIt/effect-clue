/**
 * Pure geometry / config-resolution helpers for the tour popover.
 *
 * These live separately from `TourPopover.tsx` so they can be unit-
 * tested in jsdom (no Radix portal mount, no `motion/react` mock,
 * no client-side React tree) — the kind of drift this catches:
 *
 *   - A step's `sideByViewport` was added but the desktop branch
 *     resolves to the wrong side because of a typo in the helper.
 *   - `popoverAnchorPriority: "last-visible"` accidentally gets
 *     treated as "first-visible" because of a string-discriminator
 *     refactor.
 *   - `unionRect` accidentally includes a zero-area rect and the
 *     spotlight stretches to the document origin.
 *
 * jsdom can't verify the popover's *final* on-screen position
 * (Radix's positioning runs Floating UI which needs the popover's
 * own bounding rect — and the popover renders into a portal where
 * jsdom returns 0×0). For that, walk the tour in `next-dev` per
 * the Tour-popover verification section in CLAUDE.md.
 */
import type { TourStep } from "./tours";

type PopoverSide = "top" | "right" | "bottom" | "left";
type PopoverAlign = "start" | "center" | "end";

const DEFAULT_SIDE: PopoverSide = "bottom";
const DEFAULT_ALIGN: PopoverAlign = "center";
const DESKTOP_BREAKPOINT_QUERY = "(min-width: 800px)";

/**
 * Read the active breakpoint from `window.matchMedia`. Falls back to
 * `false` (mobile) for SSR / tests where matchMedia isn't available.
 * Tests can stub `window.matchMedia` to flip this synchronously.
 */
export const isDesktopViewport = (): boolean => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(DESKTOP_BREAKPOINT_QUERY).matches;
};

/**
 * Find every on-page element a tour step targets.
 *
 * Uses the `~=` attribute selector so a single DOM element can carry
 * multiple anchor names (space-separated), e.g. the first cell of the
 * checklist grid is both `setup-known-cell` and `checklist-cell`.
 * Returns the empty array when no element matches; the caller falls
 * back to a fixed viewport position.
 */
export const findAnchorElements = (anchor: string): HTMLElement[] => {
    if (typeof document === "undefined") return [];
    return Array.from(
        document.querySelectorAll<HTMLElement>(
            `[data-tour-anchor~="${anchor}"]`,
        ),
    );
};

/**
 * Resolve a step's anchor token, picking the right one for the
 * current viewport when `anchorByViewport` is set. The mobile
 * breakpoint matches the layout boundary used everywhere else
 * (BottomNav vs desktop Toolbar; PlayLayout's single-pane vs
 * side-by-side render). Falls back to `step.anchor` for SSR / tests
 * where matchMedia hasn't run yet.
 */
export const resolveAnchorToken = (step: TourStep): string => {
    if (!step.anchorByViewport) return step.anchor;
    if (typeof window === "undefined") return step.anchor;
    return isDesktopViewport()
        ? step.anchorByViewport.desktop
        : step.anchorByViewport.mobile;
};

/**
 * Resolve the token used to position the POPOVER specifically. Falls
 * back to the spotlight token when no override is set, so steps that
 * don't care about decoupling the two get today's behavior. Same
 * viewport-conditional + SSR fallback logic as `resolveAnchorToken`.
 */
export const resolvePopoverAnchorToken = (step: TourStep): string =>
    step.popoverAnchor ?? resolveAnchorToken(step);

/**
 * Resolve the popover's `side` and `align` for the active viewport.
 * `sideByViewport` wins when set; otherwise falls back to the
 * top-level `side`/`align`, then to Radix defaults of
 * `bottom`/`center`. Mirrors `resolveAnchorToken`'s SSR fallback
 * (mobile config when matchMedia isn't available — matches the
 * `useHasKeyboard` / BottomNav default).
 */
export const resolveSideAndAlign = (
    step: TourStep,
): { side: PopoverSide; align: PopoverAlign } => {
    const fallbackSide = step.side ?? DEFAULT_SIDE;
    const fallbackAlign = step.align ?? DEFAULT_ALIGN;
    if (!step.sideByViewport) {
        return { side: fallbackSide, align: fallbackAlign };
    }
    if (typeof window === "undefined") {
        const m = step.sideByViewport.mobile;
        return {
            side: m.side ?? fallbackSide,
            align: m.align ?? fallbackAlign,
        };
    }
    const v = isDesktopViewport()
        ? step.sideByViewport.desktop
        : step.sideByViewport.mobile;
    return {
        side: v.side ?? fallbackSide,
        align: v.align ?? fallbackAlign,
    };
};

/**
 * The smallest axis-aligned rect that contains every input rect.
 * Used to highlight a row, a column, or any group of elements as a
 * single spotlight without rendering one per element.
 *
 * Zero-area rects (typically `display: none` siblings — e.g. the
 * Toolbar's ⋯ trigger that's hidden on mobile while the BottomNav's
 * ⋯ trigger carries the same anchor) are filtered out before
 * unioning. Including them would extend the union all the way to
 * the document origin (0,0), making the spotlight cover huge swaths
 * of the page.
 */
export const unionRect = (rects: ReadonlyArray<DOMRect>): DOMRect | null => {
    const visible = rects.filter(r => r.width > 0 && r.height > 0);
    if (visible.length === 0) return null;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const r of visible) {
        if (r.left < left) left = r.left;
        if (r.top < top) top = r.top;
        if (r.right > right) right = r.right;
        if (r.bottom > bottom) bottom = r.bottom;
    }
    return new DOMRect(left, top, right - left, bottom - top);
};

/**
 * Resolve whether the popover's pointer arrow should be HIDDEN for
 * the active viewport. `hideArrow.desktop` / `.mobile` opt out of
 * the arrow on each breakpoint; missing keys default to `false`
 * (arrow shown). Most steps don't set `hideArrow` at all and the
 * arrow renders as a normal Radix Popover.Arrow.
 */
export const resolveHideArrow = (step: TourStep): boolean => {
    if (!step.hideArrow) return false;
    const isDesktop = isDesktopViewport();
    return isDesktop
        ? step.hideArrow.desktop ?? false
        : step.hideArrow.mobile ?? false;
};

/**
 * Pick the rect of the visible element that should drive the popover
 * position, honouring `step.popoverAnchorPriority`:
 *
 *   - `"first-visible"` (default) — first non-zero-area element in
 *     DOM order. Right for the common case where multiple matches
 *     are CSS-hidden alternates (Toolbar / BottomNav variants).
 *   - `"last-visible"` — last non-zero-area element. Right for
 *     portaled overlays where the trigger is in DOM order before
 *     the open menu content but the popover should anchor against
 *     the open content.
 *
 * Returns `null` when no element has a non-zero area; the caller
 * uses a fallback viewport-corner rect.
 */
export const pickPopoverRect = (
    elements: ReadonlyArray<HTMLElement>,
    priority: TourStep["popoverAnchorPriority"],
): DOMRect | null => {
    const ordered =
        priority === "last-visible" ? [...elements].reverse() : elements;
    for (const el of ordered) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return r;
    }
    return null;
};
