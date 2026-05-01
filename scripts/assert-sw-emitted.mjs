#!/usr/bin/env node
/**
 * Post-build assertion: `public/sw.js` must exist after a production
 * build, otherwise the installed PWA falls back to Chrome's "you are
 * offline" page and we silently ship a broken offline experience.
 *
 * Wired into CI after `pnpm build`. Cheap (one `fs.access` call) but
 * catches the regression we fell into when `@serwist/next` (the
 * webpack plugin) silently no-op'd under Turbopack — see
 * `serwist.config.js` and the Round 4 plan for context.
 *
 * Exits 1 on missing file. The error message points the reader at
 * the configurator-mode setup so a future maintainer who breaks the
 * build chain has a single place to look.
 */
import { access } from "node:fs/promises";
import { resolve } from "node:path";

const swPath = resolve(process.cwd(), "public/sw.js");

try {
    await access(swPath);
    console.log(`assert-sw-emitted: ${swPath} OK`);
} catch {
    console.error(
        `assert-sw-emitted: FAIL — ${swPath} was not emitted by the build.\n` +
            `  This usually means \`serwist build\` (the post-step in the \`build\`\n` +
            `  script) didn't run or didn't write its output. Check:\n` +
            `    1. \`package.json\` build script ends with \`&& serwist build\`.\n` +
            `    2. \`serwist.config.js\` exists at the repo root.\n` +
            `    3. \`@serwist/cli\` resolves cleanly under pnpm.\n` +
            `  See \`docs/setup-vercel-neon-google.md\` for the full deploy chain.`,
    );
    process.exit(1);
}
