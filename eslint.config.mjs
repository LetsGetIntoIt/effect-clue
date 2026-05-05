import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import i18next from "eslint-plugin-i18next";
import { createRequire } from "node:module";

// Pull in the HTML-entity regex the i18next plugin uses internally.
// Declaring our own `words.exclude` list replaces the defaults rather
// than extending them, so we have to re-add the built-ins ourselves.
const require = createRequire(import.meta.url);
const pluginHtmlEntitiesRegex = require(
    "eslint-plugin-i18next/lib/options/htmlEntities.js",
);

/**
 * Flat ESLint config. Two things we care about:
 *
 *  1. Ban `any` — both implicit (TypeScript's `strict`/`noImplicitAny`
 *     catches these in `pnpm typecheck`) and explicit via the
 *     `@typescript-eslint/no-explicit-any` rule below.
 *
 *  2. Ban untranslated user-facing strings. `eslint-plugin-i18next`'s
 *     `no-literal-string` runs in "all" mode (not just JSX) so it also
 *     catches bare strings inside `window.confirm(...)`, `setError(...)`,
 *     `throw new Error(...)`, etc. The plugin's default `words.exclude`
 *     regex already exempts discriminator values (`"Player"`),
 *     all-caps action type tags, CSS class names, and the like — so
 *     turning off `markupOnly` doesn't flood the output with noise.
 *
 * Both rules are scoped to the source tree; tests / generated output /
 * build artifacts are ignored.
 */
export default [
    {
        ignores: [
            "**/.next/**",
            "**/node_modules/**",
            "**/coverage/**",
            "**/dist/**",
            "**/out/**",
            "**/messages/**",
            "**/.claude/worktrees/**",
        ],
    },
    {
        // Root-level TypeScript config files (next.config.ts,
        // postcss.config.ts, jest.config.ts) need the TS parser too;
        // they don't participate in any lint rules, just need to parse.
        files: ["*.ts", "*.tsx"],
        languageOptions: {
            parser: tsparser,
            parserOptions: { ecmaVersion: "latest", sourceType: "module" },
        },
        rules: {},
    },
    {
        files: ["src/**/*.ts", "src/**/*.tsx", "app/**/*.ts", "app/**/*.tsx"],
        languageOptions: {
            parser: tsparser,
            parserOptions: { ecmaVersion: "latest", sourceType: "module" },
        },
        plugins: {
            "@typescript-eslint": tseslint,
            i18next,
        },
        rules: {
            "@typescript-eslint/no-explicit-any": "error",
            "i18next/no-literal-string": [
                "error",
                {
                    // `mode: "all"` checks every string literal, not
                    // just JSX text. The plugin's default
                    // `words.exclude` already ignores discriminator-
                    // style strings (all-caps, short identifiers,
                    // punctuation-only, etc.) so false positives stay
                    // low. (NB: the commonly-cited `markupOnly` option
                    // is NOT in the plugin's schema — setting it has
                    // no effect. `mode` is the real knob.)
                    mode: "all",
                    // Extra callees whose string args are never user
                    // copy. Everything else gets checked.
                    callees: {
                        exclude: [
                            // Plugin defaults we want to preserve.
                            "i18n(ext)?",
                            "t",
                            "require",
                            "addEventListener",
                            "removeEventListener",
                            "postMessage",
                            "getElementById",
                            "dispatch",
                            "commit",
                            "includes",
                            "indexOf",
                            "endsWith",
                            "startsWith",
                            // keyMap module — first arg is a binding ID,
                            // an internal type-system token (not user copy).
                            "matches",
                            "label",
                            "allLabels",
                            "getBinding",
                            "useGlobalShortcut",
                            // Translator namespaces / namespace hooks.
                            // Matches `t`, `tReasons`, `tDeduce`, etc.
                            // Any local variable that's a translator
                            // alias follows the `t*` convention.
                            "t\\w*",
                            "t\\w*\\.rich",
                            "useTranslations",
                            // localStorage, DOM style, console.
                            "getItem",
                            "setItem",
                            "removeItem",
                            "setProperty",
                            "getPropertyValue",
                            "querySelector(All)?",
                            "console\\.(log|warn|error|info|debug)",
                            // Branded-id constructors are called with
                            // internal ids (`Card("card-miss-scarlet")`),
                            // never with user copy.
                            "Player",
                            "Card",
                            "CardCategory",
                            "SuggestionId",
                            // Effect / Schema constructors.
                            "Schema\\.\\w+",
                            "Brand\\.\\w+",
                            "Data\\.\\w+",
                            // Effect services register themselves with a
                            // string key; that's a type-system token.
                            "Context\\.Service",
                            // `Effect.fn("module.operation")` names a
                            // tracing span — internal observability key,
                            // never user copy.
                            "Effect\\.fn",
                            // `window.open(url, targetName, features)`
                            // takes the route, the named-tab target, and
                            // a features list — none of them user copy.
                            "window\\.open",
                        ],
                    },
                    // Exempt attributes that carry non-copy values
                    // (class names, CSS keys, refs, aria-hidden bool).
                    "jsx-attributes": {
                        exclude: [
                            "className",
                            "class",
                            "style",
                            "styleName",
                            "type",
                            "key",
                            "id",
                            "role",
                            "width",
                            "height",
                            "aria-hidden",
                            "aria-orientation",
                            "data-.*",
                            // Positioning / variant tokens on
                            // component props (Radix Popover's
                            // `side` / `align`, our own `variant`).
                            "side",
                            "align",
                            "variant",
                            // Internal discriminator on `<InfoPopover>`
                            // — names a hover-zone identifier that
                            // parent focus-blur logic reads via
                            // `data-popover-zone`. Not user copy.
                            "popoverZone",
                            // `<AboutContent context="page" | "modal" />`
                            // — discriminator for which surface fired
                            // an analytics event, not user copy.
                            "context",
                        ],
                    },
                    // Ignore object-property values on common setup
                    // keys (test metadata, config). The plugin also has
                    // a default exemption for ALL-CAPS keys.
                    "object-properties": {
                        exclude: [
                            "[A-Z_-]+",
                            "subsets",
                            "weight",
                            "display",
                            "variable",
                            "type",
                            "icon",
                            "size",
                            "side",
                            "id",
                            "slug",
                            "kind",
                            "_tag",
                            "runtimeExecutable",
                            "packageManager",
                            "name",
                            // Analytics-event prop discriminators —
                            // `method`, `source`, `context` are all
                            // PostHog event property keys, not copy.
                            "method",
                            "source",
                            "context",
                        ],
                    },
                    // Additional common words that are discriminator
                    // values rather than copy.
                    words: {
                        exclude: [
                            // Plugin built-ins (declaring our own
                            // `exclude` drops these).
                            "[0-9!-/:-@[-`{-~]+",
                            "[A-Z_-]+",
                            pluginHtmlEntitiesRegex,
                            /^\p{Emoji}+$/u,
                            // Tailwind class-string shape: lowercase
                            // letters / digits / spaces and Tailwind-
                            // specific markers, with at least one
                            // of those markers present so that plain
                            // English words ("card", "player") still
                            // get flagged. Required markers: any of
                            // `-`, `:`, `[`, `/`, or a digit.
                            /^(?=.*[-:[\/0-9])[-a-z0-9:[\]().%+#@&*_,\/\s]+$/,
                            // Next.js "use client" / "use server"
                            // directives — not user-facing copy.
                            "use client",
                            "use server",
                            "use strict",
                            // Cell-value glyphs rendered as-is.
                            "✓",
                            "✕",
                            "·",
                            // Undo / redo / overflow glyphs in the
                            // mobile BottomNav.
                            "↶",
                            "↷",
                            "⋯",
                            // ICU `select` branch keys — internal
                            // discriminator tags passed into the
                            // `refutationLine` template. Not user copy.
                            "none",
                            "refuted",
                            "refutedSeen",
                            "refutedPassed",
                            "refutedSeenPassed",
                            "nobody",
                            "nobodyPassed",
                            // Effect / domain discriminators.
                            "Player",
                            "CaseFile",
                            "Success",
                            "Failure",
                            "Contradiction",
                            // Internal identifiers that happen to
                            // read as words (CSS-key-style).
                            "case-file",
                            // Config keys used as string values.
                            "effect",
                            "next-dev",
                        ],
                    },
                },
            ],
        },
    },
    {
        // Tests and non-UI logic modules can keep bare strings — the
        // rule is aimed at user-facing copy, and these files don't
        // render anything to the DOM.
        files: [
            "src/**/*.test.{ts,tsx}",
            "src/**/test-utils/**/*.ts",
            "src/logic/**/*.ts",
            "src/i18n/**/*.ts",
            "src/ui/state.tsx",
            "src/ui/HoverContext.tsx",
            "src/ui/describeAction.ts",
            // Observability + analytics modules deal in internal
            // string keys (event names, OTel attribute keys, env-var
            // values) — never user-facing copy.
            "src/analytics/**/*.ts",
            "src/observability/**/*.ts",
            "app/Providers.tsx",
            "instrumentation-client.ts",
            "next.config.ts",
            "jest.config.ts",
            "jest.setup.ts",
            "postcss.config.*",
        ],
        rules: {
            "i18next/no-literal-string": "off",
        },
    },
];
