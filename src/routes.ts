/**
 * Single source of truth for in-app paths. Every `<a href>`,
 * `router.replace`, `redirect`, and `window.open` should reference
 * `routes.<name>` rather than hard-coding the string.
 *
 * If a future route ever needs path or query params, switch its entry
 * to a function — e.g. `game: (id: string) => `/game/${id}` ` — and
 * call sites keep the same shape.
 */
export const routes = {
    root: "/",
    play: "/play",
    about: "/about",
} as const;
