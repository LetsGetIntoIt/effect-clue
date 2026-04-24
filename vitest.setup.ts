// Augments Vitest's `expect` with jest-dom matchers
// (`toBeInTheDocument`, `toBeDisabled`, etc.). The `/vitest` subpath
// is what registers them against Vitest's scoped `expect` — the bare
// `@testing-library/jest-dom` import only augments the legacy global.
import "@testing-library/jest-dom/vitest";

// `@testing-library/react`'s automatic per-test cleanup hooks into the
// global `afterEach`. Our Vitest config keeps `globals: false` so that
// every test file imports `describe` / `test` / `expect` explicitly,
// which means the library can't find a global `afterEach` — we have to
// wire the cleanup up ourselves or rendered DOM leaks between tests.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
afterEach(() => {
    cleanup();
});

// Registers Effect's `Equal.equals` as a Vitest equality tester, so
// `toEqual` / `toStrictEqual` / structural matchers on Data classes,
// HashMap, HashSet, etc. compare by Effect's notion of equality
// instead of reference identity.
import { addEqualityTesters } from "@effect/vitest";
addEqualityTesters();

// jsdom ships without `TextEncoder` / `TextDecoder` on the global.
// Some dependencies (effect's `Encoding` module) reference them at
// module-load time, so polyfill before any test imports them.
import { TextDecoder, TextEncoder } from "util";

if (typeof globalThis.TextEncoder === "undefined") {
    (globalThis as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder =
        TextEncoder;
}
if (typeof globalThis.TextDecoder === "undefined") {
    (globalThis as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder =
        TextDecoder;
}
