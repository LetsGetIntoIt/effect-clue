/**
 * Renders a pre-encoded QR-code SVG string into the DOM.
 *
 * This is the *only* place in the app that uses
 * `dangerouslySetInnerHTML`. Containing it here means a code reviewer
 * can audit the whole "raw HTML → React" surface area in one file
 * instead of grepping the codebase.
 *
 * ## Why this is safe
 *
 * The `svgSource` we render is produced by lean-qr's `toSvgSource`
 * (see `lean-qr/extras/svg.mjs`). lean-qr emits a fixed, allow-listed
 * shape — `<svg>` plus `<rect>` / `<path>` children — built from
 * numeric grid coordinates and color/dimension attributes that the
 * library itself supplies. The only string we feed lean-qr is the
 * share URL we just minted server-side; lean-qr encodes that into the
 * QR matrix's bit pattern, NOT into the resulting SVG markup. The
 * library also escapes attribute values when assembling the source
 * string (`.replace(/[^ -~]|["&]/g,"")`), so even a hostile string
 * wouldn't reach attribute context as raw HTML.
 *
 * In short: the URL is data, lean-qr's output is structural, and there
 * is no path by which user input flows into the rendered HTML as
 * markup. If the input source ever changes (e.g. accepting a
 * caller-supplied SVG string from elsewhere), this safety argument
 * stops holding and the call site must be re-audited.
 *
 * The `[&>svg]:` Tailwind selectors stretch lean-qr's intrinsic
 * width/height to fill the container while keeping aspect ratio.
 *
 * ## Sizing
 *
 * The QR should be as big as possible without pushing the surrounding
 * modal taller than the viewport. The wrapper is square
 * (`aspect-square`) and capped at:
 *
 *   max-width = min(100% of container, max(8rem, 100dvh − 24rem))
 *
 * The 100% term lets the QR fill its parent on tall viewports where
 * the modal width is the binding constraint (e.g. desktop, where the
 * modal caps at ~480px). The `100dvh − 24rem` term kicks in on short
 * viewports (landscape phones, small laptops): 24rem (384px) is a
 * conservative reservation for the rest of the modal — header, body
 * text, link-expires line, the URL/copy row, the footer button row,
 * plus a safety buffer. `100dvh` (dynamic viewport height) is used
 * instead of `100vh` so mobile-browser chrome is accounted for as it
 * shows / hides during scroll.
 *
 * The `max(8rem, …)` floor protects the QR on viewports so short that
 * 100dvh − 24rem is negative or tiny — at that point the QR would
 * otherwise collapse to 0×0. 8rem (128px) is the smallest size a QR
 * can be scanned reliably; below that, we'd rather force the modal
 * to scroll (the modal's own `overflow-y-auto` handles that).
 */
type QrCodeSvgProps = {
    readonly svgSource: string;
    readonly ariaLabel: string;
    readonly className?: string;
    readonly dataAttribute?: string;
};

export function QrCodeSvg({
    svgSource,
    ariaLabel,
    className,
    dataAttribute,
}: QrCodeSvgProps) {
    // The wrapper div carries the role + aria-label so screen readers
    // announce "QR code for <url>" rather than the raw <svg>'s
    // (absent) accessible name.
    const dataProps =
        dataAttribute !== undefined ? { [dataAttribute]: true } : {};
    return (
        <div
            role="img"
            aria-label={ariaLabel}
            className={`mx-auto aspect-square w-full max-w-[min(100%,max(8rem,calc(100dvh-24rem)))] [&>svg]:h-full [&>svg]:w-full ${className ?? ""}`.trim()}
            // Safe: see file-level comment. svgSource is produced by
            // lean-qr's `toSvgSource`, which emits a fixed structural
            // SVG string from a QR-encoded bit matrix — no caller
            // input reaches the markup as HTML.
            dangerouslySetInnerHTML={{ __html: svgSource }}
            {...dataProps}
        />
    );
}
