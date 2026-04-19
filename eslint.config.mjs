import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import i18next from "eslint-plugin-i18next";

/**
 * Flat ESLint config. Two things we care about:
 *
 *  1. Ban `any` — both implicit (TypeScript's `strict`/`noImplicitAny`
 *     catches these in `pnpm typecheck`) and explicit via the
 *     `@typescript-eslint/no-explicit-any` rule below.
 *
 *  2. Ban untranslated JSX literals — `eslint-plugin-i18next`'s
 *     `no-literal-string` rule flags bare string literals in JSX /
 *     JSX attributes so we can catch new UI copy that wasn't funneled
 *     through `messages/en.json` + `useTranslations`.
 *
 * Both rules are scoped to app / src only — tests, generated output,
 * and build artifacts are ignored.
 */
export default [
    {
        ignores: [
            ".next/**",
            "node_modules/**",
            "coverage/**",
            "dist/**",
            "out/**",
            "messages/**",
        ],
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
            // Only check JSX leaf text + string-valued attributes the user
            // actually reads. `className`, `title`, `aria-*` etc. are on the
            // `message` list; everything else is ignored.
            "i18next/no-literal-string": [
                "error",
                {
                    markupOnly: true,
                    onlyAttribute: [
                        "title",
                        "aria-label",
                        "placeholder",
                        "alt",
                    ],
                },
            ],
        },
    },
    {
        // Tests and non-JSX modules (domain logic, state, persistence)
        // are TypeScript but not user-facing UI — skip the literal check.
        files: [
            "src/**/*.test.ts",
            "src/**/test-utils/**/*.ts",
            "src/logic/**/*.ts",
            "src/i18n/**/*.ts",
            "src/ui/state.tsx",
            "src/ui/HoverContext.tsx",
        ],
        rules: {
            "i18next/no-literal-string": "off",
        },
    },
];
