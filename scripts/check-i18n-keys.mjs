#!/usr/bin/env node
/**
 * Orphaned-key audit for messages/en.json.
 *
 * next-intl's `t()` call sites use (a) literal keys — t("cardPack")
 * — and (b) template-literal keys — tReasons(`${x.kind}.headline`).
 * This script flattens every key in en.json and looks for it in
 * source under three shapes:
 *
 *   1. Full dotted path ("setup.cardPack")
 *   2. Leaf-only ("cardPack")
 *   3. Last-two-segments ("actions.loadCardSet")
 *
 * For template-literal keys we detect `${...}.<static-suffix>`
 * patterns and mark every key ending in that suffix as used.
 * The heuristic has false positives on very common suffixes ("detail",
 * "headline") — but those happen to be exactly the reasons-namespace
 * keys which are genuinely template-dispatched, so the check stays
 * accurate in practice.
 *
 * Wire into CI via `pnpm i18n:check` (see package.json scripts).
 * Exit code is 1 when orphaned keys are found.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const messagesPath = path.join(root, "messages/en.json");
const srcDir = path.join(root, "src");
const layoutFile = path.join(root, "app/layout.tsx");

// --- load keys ----------------------------------------------------------
const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
const keys = [];
const flatten = (obj, prefix) => {
    for (const k of Object.keys(obj)) {
        const v = obj[k];
        const full = prefix ? `${prefix}.${k}` : k;
        if (v !== null && typeof v === "object") flatten(v, full);
        else keys.push(full);
    }
};
flatten(messages, "");

// --- collect source strings ---------------------------------------------
const srcFiles = [];
const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name.startsWith("."))
                continue;
            walk(p);
        } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
            srcFiles.push(p);
        }
    }
};
walk(srcDir);
if (fs.existsSync(layoutFile)) srcFiles.push(layoutFile);

const stringsInSource = new Set();
const templateSuffixes = new Set();
for (const file of srcFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/['"`]([a-zA-Z][a-zA-Z0-9._-]+)['"`]/g)) {
        stringsInSource.add(m[1]);
    }
    // Template-literal suffix pattern: `${anything}.staticSuffix`
    for (const m of text.matchAll(/\$\{[^}]+\}\.([a-zA-Z][a-zA-Z0-9_]+)/g)) {
        templateSuffixes.add(m[1]);
    }
    // Object member access like `messages.app.description` — capture
    // every dotted chain. Add each *suffix* of the chain so a key that
    // lives at `app.description` matches when source reads from
    // `messages.app.description`.
    for (const m of text.matchAll(/\b([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)+)/g)) {
        const parts = m[1].split(".");
        for (let i = 0; i < parts.length; i++) {
            stringsInSource.add(parts.slice(i).join("."));
        }
    }
}

// --- classify keys ------------------------------------------------------
const orphaned = [];
for (const key of keys) {
    if (stringsInSource.has(key)) continue;
    const parts = key.split(".");
    const leaf = parts[parts.length - 1];
    if (stringsInSource.has(leaf)) continue;
    const last2 = parts.slice(-2).join(".");
    if (stringsInSource.has(last2)) continue;
    if (templateSuffixes.has(leaf)) continue;
    orphaned.push(key);
}

// --- report -------------------------------------------------------------
console.log(`Scanned ${keys.length} keys in messages/en.json`);
console.log(`Across ${srcFiles.length} source files`);
if (orphaned.length === 0) {
    console.log("All keys referenced. ✔");
    process.exit(0);
}
console.log(`\n${orphaned.length} orphaned key(s):`);
for (const k of orphaned) console.log(`  ${k}`);
process.exit(1);
