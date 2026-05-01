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

// Note on onboarding-gate state in tests: any test that mounts
// <Clue/> needs to suppress the splash + tour + install auto-fires
// or they stack on top of the underlying UI. Use the
// `seedOnboardingDismissed()` helper from `src/test-utils/onboardingSeed.ts`
// in the test file's own `beforeEach`, after `localStorage.clear()`.
// We don't seed globally because most test files clear localStorage
// themselves, which would wipe a global seed before each test starts.

// Registers Effect's `Equal.equals` as a Vitest equality tester, so
// `toEqual` / `toStrictEqual` / structural matchers on Data classes,
// HashMap, HashSet, etc. compare by Effect's notion of equality
// instead of reference identity.
import { addEqualityTesters } from "@effect/vitest";
addEqualityTesters();

// jsdom doesn't ship `matchMedia`. Several UI hooks
// (`useIsDesktop`, motion's `useReducedMotion`) read it during
// render, so any test that mounts a component reaching those hooks
// would crash without this polyfill. The default returns `matches:
// false` — tests that need a specific breakpoint override it
// in-file via `vi.spyOn(window, "matchMedia")`.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string): MediaQueryList => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
        }),
    });
}

// jsdom doesn't ship `ResizeObserver` either. The Clue layout uses one
// to publish the header height into a CSS variable; without a stub the
// `useLayoutEffect` would crash on mount.
if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserverStub {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
        ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom logs `Not implemented: Window's scrollTo() method` for any
// `window.scrollTo` call. The Clue layout calls it on Setup ↔ Play
// switches to reset page scroll; stub it so tests stay quiet.
if (typeof window !== "undefined") {
    window.scrollTo = (() => {}) as typeof window.scrollTo;
}

// jsdom doesn't define `Element.prototype.scrollIntoView`. The dropdown
// list components call it to keep the arrow-key-highlighted row visible;
// without a stub any test that mounts those popovers would crash.
if (
    typeof Element !== "undefined" &&
    typeof Element.prototype.scrollIntoView !== "function"
) {
    Element.prototype.scrollIntoView = function () {};
}

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
