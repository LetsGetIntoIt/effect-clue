import { useLocale } from "next-intl";
import { useMemo } from "react";

/**
 * Thin wrapper around `Intl.ListFormat` that memoises on the active
 * next-intl locale. Gives consumers a locale-aware list join — e.g.
 * "A, B, and C" in en-US vs. "A、B 和 C" in zh — without manually
 * tracking locale changes.
 *
 * Style / type follow the Intl.ListFormat options:
 *   - style: "long" | "short" | "narrow" — how the conjunction word
 *     appears. "long" in en = "A, B, and C"; "narrow" = "A, B, C".
 *   - type:  "conjunction" | "disjunction" — "and" vs. "or" in the
 *     final position.
 */
export function useListFormatter(
    style: "narrow" | "short" | "long" = "long",
    type: "conjunction" | "disjunction" = "conjunction",
): Intl.ListFormat {
    const locale = useLocale();
    return useMemo(
        () => new Intl.ListFormat(locale, { style, type }),
        [locale, style, type],
    );
}
