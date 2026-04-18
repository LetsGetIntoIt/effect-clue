// Tailwind v4 does prefixing internally, so no autoprefixer needed.
// PostCSS doesn't natively support TypeScript configs; the rest of
// the project uses .ts configs, but this one stays .mjs per the
// Tailwind/Next.js recipe.
const config = {
    plugins: {
        "@tailwindcss/postcss": {},
    },
};

export default config;
