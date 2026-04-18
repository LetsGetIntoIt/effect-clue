/**
 * PostCSS config. Next.js 15 reads both `postcss.config.ts` and
 * `postcss.config.mjs`; the docs recipe uses `.mjs`, but TS works as
 * long as the exported default is a plain config object (no imports
 * that need runtime bundling).
 *
 * Tailwind v4 handles vendor prefixing internally, so no autoprefixer.
 *
 * Minimal local type declared inline rather than pulling in the
 * `postcss-load-config` package just for one file.
 */
interface PostCssConfig {
    readonly plugins: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

const config: PostCssConfig = {
    plugins: {
        "@tailwindcss/postcss": {},
    },
};

export default config;
