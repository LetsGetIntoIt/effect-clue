#!/usr/bin/env node
/**
 * Defense-in-depth layer 6 for the dev-only email/password sign-in
 * path. Runs after `pnpm build` and greps the production bundle
 * for any of the dev-only identifiers; if any of them appear, fails
 * the build.
 *
 * The dev-auth subtree is gated by:
 *   - `emailAndPassword.enabled = isDev`              (auth.ts)
 *   - API route 404 for sign-{in,up}/email when prod   (route.ts)
 *   - `Effect.die` in the bespoke dev-auth action      (dev-auth.ts)
 *   - JSX-level `process.env.NODE_ENV === "development"`(AccountModal)
 *   - module-load assertion when DEV_AUTH_ENABLED      (auth.ts)
 *   - this script.
 *
 * Wired into the GH Actions workflow after `pnpm build`. Locally
 * via `pnpm assert:no-dev-auth` after a `pnpm build` run.
 *
 * If a future refactor renames any of these identifiers, update the
 * `forbidden` array below to match. The principle is: the
 * dev-only-but-tree-shaken-from-prod identifiers are stable strings,
 * not opaque hashes — keep them human-readable so the grep is
 * trivial.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const BUILD_DIR = path.join(process.cwd(), ".next");

// Identifiers that should NEVER appear in a production bundle.
// Each must remain a stable string in the source; if a refactor
// changes the name, update this list.
//
// Notably ABSENT: the literal URL strings `/sign-up/email` and
// `/sign-in/email`. Those legitimately appear in the production
// bundle inside `app/api/auth/[...all]/route.ts`'s guard, which
// 404s them when `NODE_ENV !== "development"`. Grepping for the
// URL paths produces false positives. Greppin for the JS
// identifiers (the React component name + the bespoke server
// action symbol) is the right level — those must be tree-shaken
// out of any production bundle.
const FORBIDDEN = [
    "DevSignInForm",
    "signInWithDevCredentials",
];

const findFiles = async (dir, predicate) => {
    let entries;
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    const out = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const sub = await findFiles(full, predicate);
            out.push(...sub);
        } else if (entry.isFile() && predicate(full)) {
            out.push(full);
        }
    }
    return out;
};

const main = async () => {
    if (process.env.SKIP_DEV_AUTH_ASSERT === "1") {
        console.log(
            "[assert-no-dev-auth] SKIP_DEV_AUTH_ASSERT=1 — skipping.",
        );
        return;
    }

    // Production build artifacts. Both the JS chunks under
    // `.next/static/chunks/` AND the server-rendered chunks under
    // `.next/server/chunks/` need to be scanned — the dev-only
    // identifiers must be eliminated from both.
    const isJsChunk = (p) =>
        (p.endsWith(".js") || p.endsWith(".mjs")) &&
        !p.includes("__next_devtools__") &&
        !p.includes("hot-reloader");
    const files = [
        ...(await findFiles(
            path.join(BUILD_DIR, "static", "chunks"),
            isJsChunk,
        )),
        ...(await findFiles(
            path.join(BUILD_DIR, "server", "chunks"),
            isJsChunk,
        )),
        ...(await findFiles(
            path.join(BUILD_DIR, "server", "app"),
            isJsChunk,
        )),
    ];

    if (files.length === 0) {
        console.error(
            "[assert-no-dev-auth] No build artifacts found under .next. Run `pnpm build` first.",
        );
        process.exitCode = 1;
        return;
    }

    let leaks = 0;
    for (const file of files) {
        const buf = await fs.readFile(file, "utf-8");
        for (const needle of FORBIDDEN) {
            if (buf.includes(needle)) {
                console.error(
                    `[assert-no-dev-auth] LEAK: '${needle}' found in ${path.relative(process.cwd(), file)}`,
                );
                leaks += 1;
            }
        }
    }

    if (leaks > 0) {
        console.error(
            `[assert-no-dev-auth] FAIL: ${leaks} dev-auth identifier leak(s) detected in the production bundle.`,
        );
        process.exitCode = 1;
        return;
    }

    console.log(
        `[assert-no-dev-auth] OK — scanned ${files.length} files, no dev-auth identifiers found.`,
    );
};

await main();
