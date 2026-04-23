// Augments `expect` from `@jest/globals` with jest-dom matchers
// (`toBeInTheDocument`, `toBeDisabled`, etc.). Note the `/jest-globals`
// entry — the bare `@testing-library/jest-dom` import only augments the
// legacy global `expect`, not `@jest/globals`.
import "@testing-library/jest-dom/jest-globals";

// jsdom 29 ships without `TextEncoder` / `TextDecoder` on the global.
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
