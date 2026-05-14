# Project conventions

This is the shared agent instruction file. `AGENTS.md` is the real file for
Codex, and `CLAUDE.md` is a symlink to it for Claude Code.

## Updating this file

When a section here changes, **rewrite the whole section cohesively** — don't append a "Update:" / "Note:" / "(post-N)" patch to the bottom. The section should read as if it had always been written that way, with old guidance pruned and new guidance woven in. A future reader skims this file top-to-bottom; layered amendments turn it into a changelog instead of a spec.

## Package manager

Use `pnpm` for everything. Never `npm`, `yarn`, or `bun`.

## Use the right Node version

### TL;DR — the only rules you need

1. **Just run `pnpm <script>` directly.** No `nvm use`, no `export NVM_DIR`, no `source ~/.nvm/nvm.sh`, no chaining. The shell profile already loads a Node that `pnpm` tolerates.
2. **Only if step 1 actually fails with an engine-version error** (the literal string `Unsupported engine` or `engine "node" is incompatible`), run `nvm use` as a *separate, standalone* Bash call. Then retry the original `pnpm` command, also as a standalone call.
3. **Only if `nvm use` itself errors** with `nvm: command not found` or `version "vX.Y.Z" is not yet installed`, run `export NVM_DIR="$HOME/.nvm" && source "$HOME/.nvm/nvm.sh"` once, retry `nvm use`, then retry the `pnpm` command.

That's it. Three escalation levels, each one a *separate* Bash tool call. Never chain across levels.

### What you must NOT do

This pattern is **forbidden**, even when each Bash tool call appears to spawn a fresh subshell:

```
# WRONG — never do this
export NVM_DIR="$HOME/.nvm" && source "$HOME/.nvm/nvm.sh" && nvm use && pnpm test
```

It is forbidden whether prepended once, prepended to every command, or "just to be safe." Reasons:

- `pnpm` works without it the overwhelming majority of the time. The prepend is solving a problem that doesn't exist.
- It triggers extra permission prompts and adds noise to the transcript.
- It hides the actual failure mode if `pnpm` does fail — you can't tell what step broke.

If you catch yourself reaching for `export NVM_DIR` or `source ~/.nvm/nvm.sh` *speculatively* (i.e. before `pnpm` has actually failed), stop. Run plain `pnpm <script>` first. Wait for the failure. Diagnose from the error message. Only escalate to the next level if the error message asks for it.

### Why this rule exists

Past behavior: assistant kept prepending the full `export NVM_DIR=… && source … && nvm use && pnpm …` chain to every single Bash call, even after being told not to, even after the previous call had already succeeded with plain `pnpm`. The user has had to correct this multiple times. Treat this rule as load-bearing.

### About the Bash tool's "fresh subshells"

You may notice that each Bash tool call appears to start a fresh subshell, so PATH changes from a previous `nvm use` don't visibly persist. That doesn't matter. The shell environment is initialized from the user's profile (`.zshrc` / `.bashrc`), which already loads a default Node. That default is sufficient for `pnpm` in this repo. Do not reason your way back into prepending nvm setup based on subshell semantics — empirically, plain `pnpm` works.

## Install dependencies

Once per shell session — and after any `package.json` / `pnpm-lock.yaml` change — run `pnpm install` from the repo root. Every script in this repo reads from `node_modules` and will error out if it hasn't been populated. Run it as a plain `pnpm install` call; do not prepend nvm setup (see the Node version section above).

In Codex, a fresh worktree may need to fetch the npm registry while the default
command sandbox has DNS/network access disabled. If `node_modules` is missing or
the install will clearly need registry tarballs, run the same plain
`pnpm install` with network approval/escalation up front. If you see
`getaddrinfo ENOTFOUND registry.npmjs.org`, treat it as sandbox networking and
retry `pnpm install` with network approval; do not change package managers,
clear the lockfile, or add nvm setup.

Scripts that require `pnpm install`:

- `pnpm typecheck` — TypeScript (`tsc --noEmit`)
- `pnpm lint` — ESLint (with `eslint-plugin-i18next`)
- `pnpm test` — Vitest (run mode) / `pnpm test:watch` — Vitest watch / `pnpm test:ui` — Vitest UI
- `pnpm knip` — unused-exports audit
- `pnpm i18n:check` — orphan-key audit (`scripts/check-i18n-keys.mjs`)
- `pnpm dev` — Next.js dev server (used by Claude's `next-dev` preview and by Codex browser verification). It starts at `PORT` or `3000`, then automatically uses the next available port if that one is busy.
- `pnpm db:up` / `pnpm db:down` — local Docker Postgres for server actions, auth, sharing, and card-pack sync
- `pnpm build` — static export
- `pnpm start` — serve the static export

Claude's `next-dev` preview configured in `.claude/launch.json` runs `pnpm install && exec pnpm dev` itself, so those previews are self-healing for `node_modules` and the dev server receives shutdown signals directly. They are **not** self-healing for `.env.local` — see "Worktree env setup" below. In Codex, use the local preview workflow below. The pre-commit checks above are not self-healing either; if any of them fails with a module-not-found error, run `pnpm install` first and retry.

## Worktree env setup

Both Claude and Codex agents typically work in a worktree under `.claude/worktrees/<name>/`. A fresh worktree starts without a `.env.local`, but `pnpm dev` exits at startup on missing `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `DATABASE_URL` (by design — see `src/server/authEnv.ts`). The fix is one shell command:

```sh
cp "$(git rev-parse --git-common-dir)/../.env.local" .env.local
```

`git rev-parse --git-common-dir` returns the shared `.git` directory of the worktree, which lives inside the main checkout, so `<git-common-dir>/../.env.local` always resolves to the main checkout's env file regardless of where the worktree sits on disk.

That's it — no `vercel env pull`, no Google Console round-trip. The agent inherits whatever the human dev already configured for the main checkout. If `.env.local` doesn't exist yet in the main checkout, see "First-time setup" in [README.md](README.md) for the one-time bootstrap (it covers creating a localhost-scoped Google OAuth client and seeding `.env.local`).

The committed [env.example](env.example) holds the variable names + non-secret defaults (Docker `DATABASE_URL`, PostHog host) but intentionally leaves the OAuth values blank — GitHub secret scanning rejects any pushed value, and "secrets in tracked files" is a footgun even when the values are dev-only.

Operational notes:

1. **Copy, don't symlink.** Edits to env in the worktree (e.g. swapping a DB URL while testing) would leak into the main checkout if symlinked. `.env.local` is gitignored.
2. **Restart after editing.** Next.js only reads env at startup, so if you change `.env.local` while the preview is running, restart it (`preview_stop` then `preview_start` for Claude; Ctrl-C and `pnpm dev` for Codex).
3. **Don't print secrets.** Print only `<set>` / `<empty>` status when inspecting env health. The full `.env.local` should be treated as opaque.

## Local database and dev server lifecycle

The local app uses Docker Postgres for server actions, Better Auth,
sharing, and synced card packs. Do not paper over PgClient connection
errors in application code; fix the local database/env setup instead.

Before starting the preview in Codex:

1. **Env file** — see "Worktree env setup" above. One `cp` from the
   main checkout's `.env.local` is enough; the agent inherits whatever
   is already working there. Don't fetch new secrets in a worktree —
   if something is missing, fix it in the main checkout's `.env.local`
   and re-copy.
2. **Database** — `pnpm db:up` starts the local Docker Postgres at
   `postgres://effect_clue:local_dev_only@localhost:5432/effect_clue`
   (the same URL `env.example` ships with).
3. **Dev server** — `pnpm dev`. Then open the `Local:` URL printed
   by Next.js in the in-app browser. Usually `http://localhost:3000`,
   but the dev script auto-selects the next available port when
   3000 is already in use.

Claude's `next-dev` preview is the same chain wrapped in
`.claude/launch.json`. The preview tooling does NOT seed `.env.local`,
so the env step (1) above still applies before `preview_start`.

Leave the dev server up for the duration of a session. Once you've
started `pnpm dev` (or `preview_start next-dev` for Claude), keep it
running so the user can manually exercise the app between turns —
don't stop it after each verification round just to "clean up". Many
sessions make several preview-driven changes back-to-back; tearing
down between them is wasted work and steals the user's ability to
re-test what's already in flight.

Tear it down only when:

1. The user explicitly asks you to (handoff, end of session, etc.).
2. Something is broken (port collision, hung process, env change that
   needs `pnpm dev` restarted to pick up). Restart, don't just stop.
3. The session is genuinely ending — your next reply is the last one,
   the work is wrapped up, and there's no plausible reason for the
   server to keep running.

Teardown sequence when it does apply: stop the same `pnpm dev` shell
session with Ctrl-C (Codex) or `preview_stop` (Claude), then
`pnpm db:down` so the Docker Postgres container isn't left running.
If you're explicitly leaving things up at the user's request, say
which server / database processes were intentionally left up.

## Verification checks

All of these must pass green before every commit:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm knip`
- `pnpm i18n:check`

If you amend or update a commit, re-run the full set — a previously-green commit can break after edits.

## Manual verification in the preview

For any change that's observable in the browser, exercise the change yourself before reporting the task done. In Claude, use the `next-dev` preview configured in `.claude/launch.json`; in Codex, follow the local database and dev server lifecycle above, then use the printed `Local:` URL in the in-app browser. Follow the active agent's browser verification workflow: start/reload the preview, check console/network/logs, take a screenshot or snapshot as proof. Don't ask the user to verify manually.

### Layout, scroll, and animation behaviors

The structural pieces below are pinned by `src/ui/components/PlayLayout.test.tsx` (mobile mounts only the active pane; desktop mounts both side-by-side). The visual / animated / sticky-positioning pieces below **cannot** be tested in jsdom — `getBoundingClientRect` returns zeroes, `position: sticky` doesn't actually pin, transforms don't extend `body.scrollWidth`, and animations don't run. So when a change touches **page structure (`src/ui/Clue.tsx`, `src/ui/components/PlayLayout.tsx`), overall layout CSS (`<main>`, sticky positioning, `contain-paint`, `contain-inline-size`, the `--header-offset` variable, the `html { overflow-x: clip } body { overflow-x: auto }` rules in `app/globals.css`), or slide animations (`slideVariants`, `AnimatePresence`)**, walk this list in the `next-dev` preview before reporting done.

Resize the preview between viewports as you go — many of these regress on one breakpoint without affecting the other.

**Vertical page scroll (test at any viewport):**

- Wheel anywhere on the page advances the Checklist table — not just over the table itself. Wheeling over the header, the blank parchment around the section, the `+ add card` row, etc., all scroll the document. (The fix that this codifies — `Move scroll to the page, not an internal viewport` — relies on no ancestor having `overflow-y: auto/scroll/hidden/clip`.)
- The sticky `<thead>` stays at the viewport top once the table's natural top has scrolled past. Column labels remain aligned with their columns.
- Force a contradiction (e.g. mark the same suspect "yes" for two players) — `GlobalContradictionBanner` slides in at the top. The sticky `<thead>` sits **below** the banner (its `top:` resolves to `var(--contradiction-banner-offset, 0px) + var(--header-offset, 0px)`), not behind it. The fixed page `<header>` also tucks under the banner via the same `--contradiction-banner-offset` variable.

**Horizontal page scroll (Play mode with a wide Checklist that doesn't fit naturally):**

- `<main>` no longer carries `min-w-max` (the legacy inSetup wide-table that needed it was removed in M6 PR-B and the wizard is narrow). The Checklist's own `<table>` is what overflows when the player count + Case file column exceed the viewport. Horizontal scroll is owned by **`<body>`**, not `<html>` (`globals.css` sets `html { overflow-x: clip }` and `body { overflow-x: auto }`). This is load-bearing: if `<html>` ever gains horizontal scroll, mobile Chrome inflates its layout viewport to match content width, and `position: fixed; right: 0` and `100vw` start resolving to body-edge instead of screen-edge — the BottomNav lands offscreen and the centred modals stop centring on the visible viewport. Keep horizontal scroll on body. Don't introduce per-table `overflow-x: auto` containers either; that would move horizontal scroll into an internal viewport and break the `Move scroll to the page, not an internal viewport` invariant.
- The page header is `position: fixed` (`top: var(--contradiction-banner-offset, 0px); inset-x: 0; bg-bg`) so its `bg-bg` always spans the full visible viewport and the title stays anchored regardless of horizontal scroll. Mobile in particular needs this: with sticky positioning, the header was constrained to `<main>`'s box (= viewport-wide on mobile), so sticky-left had no room to shift within its parent and the bg only covered ~viewport-40 px — letting the table's category-header rows peek through above the title on horizontal scroll. The `--header-offset` ResizeObserver in `Clue.tsx` publishes the header's height at every breakpoint and `<main>`'s `padding-top` consumes it (`calc(var(--contradiction-banner-offset, 0px) + var(--header-offset, 0px) + 1.5rem)`) so the in-flow `TabContent` below doesn't slide under the fixed header. The header's inner content wrapper mirrors `<main>`'s `mx-auto max-w-[1400px] px-5` so on viewports wider than 1400 px the title and toolbar stay aligned with main's content while the bg extends edge-to-edge. The same `--header-offset` also feeds the sticky checklist `<thead>`'s `top:` formula so the column labels pin right below the page header.
- Dropping back to scroll-x = 0 places everything in its natural rest position with no jump.
- The BottomNav (`src/ui/components/BottomNav.tsx`) is `position: fixed; inset-x-0; bottom-0` — pure CSS. It must read as exactly viewport-width and pinned to the visible bottom on mobile Chrome with the wide checklist scrolled. If you ever see it stretch wider than the screen, the html/body overflow rules above have likely been broken.
- Modals (`useConfirm`, `SplashModal`) are `position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%)` — also pure CSS. Same invariant: they must centre on the visible viewport, not the document. Same root cause if they ever drift.
- The Checklist's `<section id="checklist">` is wrapped in a `<div className="min-w-max">` so the rounded parchment box hugs its content's intrinsic width. The wrapper carries the `min-w-max` (the section itself is no longer `min-w-max`) and a CONDITIONAL `pe-5` that's appended only when the section's intrinsic width exceeds `window.innerWidth - 40` (the available width inside `<main>`'s `px-5`). A `ResizeObserver` on the section in `Checklist.tsx` flips a `needsRightGutter` state when that threshold crosses. When the table overflows horizontally, the `pe-5` extends `body.scrollWidth` 20px past the section's right border so the right gutter matches the 20px left gutter from `<main>`'s `px-5` once the user scrolls to the end. When the table fits, no `pe-5` is applied so both gutters sit at 20px at rest — no double-padding asymmetry. Section width is invariant to whether `pe-5` is applied (the section sits inside the wrapper's content area), so the measurement does not feed back on itself. **`mr-5` does NOT work here** — margin doesn't propagate to `body.scrollWidth` from this layout chain (the framer-motion `<motion.div>` slide container with `[grid-area:stack] min-w-0` swallows the margin), but padding does. If you need to add or move spacing around the rounded box in the future, prefer padding on the wrapper, not margin on the section. The `pe-5` is also zeroed out at the desktop breakpoint (`[@media(min-width:800px)]:pe-0`) so `DesktopPlayLayout`'s grid `gap-5` between the Checklist and the SuggestionLogPanel isn't doubled.

**Setup mode never overflows horizontally.** The wizard accordion is `max-w-[720px]` centered, no wide tables. On phones (≤375 px) `body.scrollWidth === clientWidth` while in setup mode. If the wizard ever spills, something added a long no-wrap span — fix at the spill, not by re-adding `min-w-max` to `<main>`.

**Mobile Suggest pane fits the viewport (Suggest mobile, viewport ≤ 800 px):**

- Page does NOT have a horizontal scrollbar on this view — `body.scrollWidth === clientWidth`.
- The `Add a [suggestion (⌘K)] [accusation (⌘I)]` text wraps. The `+ Suggester / + Suspect / + Weapon / + Room / + Passed by / + Refuted by / + Shown card` pill row wraps over multiple rows. Nothing extends past the right edge. (`SuggestionLogPanel`'s section uses `contain-inline-size` to stop its pill row's no-wrap intrinsic size from propagating up into the page's intrinsic width. If you remove that class, mobile Suggest will spill horizontally.)

**Setup ↔ Play slide animation (both desktop and mobile):**

- Trigger the slide both directions — overflow menu → "Game setup" and back, or `⌘H` / `⌘K`.
- Both panes overlap mid-flight (sync mode + opacity in `slideVariants`). There's no page-sized gap between when one pane finishes leaving and the other starts arriving — the entering pane is already moving in while the exiting pane is moving out.
- The browser's horizontal scrollbar does NOT flash during the slide. (The off-screen pane's `translateX(±100%)` would otherwise extend `body.scrollWidth` mid-animation.) `contain-paint` on the slide container clips that — but ONLY while the AnimatePresence transition is in flight. At rest the container drops `contain-paint` so a wide Play-mode `<Checklist>` (`min-w-max`) propagates its overflow up to `body` and the page becomes horizontally scrollable. Permanent `contain-paint` on this container would silently clip the table's scrollable overflow at the slide-container's box and break the "page owns horizontal scroll" invariant on mobile, so don't move it back to "always on" without a different mechanism for the slide flash.
- The `isAnimating` toggle that drives `contain-paint` is gated on `hydrated` and only flips true on changes from a *post-hydration* `topLevelKey` baseline. Pre-hydration `topLevelKey` is always `"setup"` (default `uiMode`); when hydration resolves the URL to e.g. `?view=checklist`, `topLevelKey` flips to `"play"` at the same render where `AnimatePresence` mounts for the first time — so it has no previous child to exit, no exit animation runs, and `onExitComplete` never fires. Treating that hydration-driven change as a "real" slide leaves `isAnimating: true` forever and pins `contain-paint` permanently, which silently kills mobile horizontal scroll. The baseline ref is `null` until the first post-hydration render captures the settled `topLevelKey`; only subsequent user-driven changes flip `isAnimating` true and rely on `onExitComplete` to clear it. If you ever rewire this to track changes without the hydration gate, re-verify the wide-table mobile scroll case after a hard nav to `/play?view=checklist`.
- After the slide completes, `window.scrollY` is back to 0 — switching tabs doesn't leave you mid-page.
- Setup → Checklist on a wide setup table has a small known regression: the exiting `<Checklist>` re-renders with `inSetup: false` the moment `state.uiMode` flips, so its table layout shrinks while sliding out and `<main>` resizes accordingly. This isn't fixable without changing `<Checklist>`'s API to accept `inSetup` as a prop instead of reading from state. Verify it still feels acceptable; if the user complains, the refactor is the next step.

**Mobile Checklist ↔ Suggest slide (`MobilePlayLayout`'s own `AnimatePresence`):**

- Slide runs in both directions (Checklist → Suggest goes right, Suggest → Checklist goes left — `getDirection` based on `PLAY_POSITIONS`).
- The inactive pane is **not** in the DOM after the slide — no off-screen suggestion log to find by horizontal-scrolling on mobile, no off-screen Checklist to find from Suggest. (Pinned by `PlayLayout.test.tsx` — but if you change the rendering pattern, eyeball it too because the test only checks one frame.)
- Horizontal page scroll on a wide Checklist still works ON the Checklist tab. The mobile slide container is `overflow-x: visible` at rest, so the inner table's `min-w-max` extends `body.scrollWidth` and the user can scroll horizontally to see the full table. `overflow-x: clip` is toggled on the container ONLY while the slide animation is in flight — the off-screen pane's `translateX(±100%)` would otherwise extend `body.scrollWidth` mid-animation and flash a horizontal scrollbar. If a future change makes the clip permanent ("safety net"), the table's horizontal scroll dies on mobile — verify both the slide AND the table-scroll path after touching the slide container's overflow rule.

**Desktop side-by-side (viewport ≥ 800 px):**

- The Checklist and the SuggestionLogPanel sit in a 2-column grid (`minmax(min-content,1fr) / minmax(0,420px)` with `gap-5`).
- Track 1's `min-content` is what makes the layout work alongside the Checklist's `min-w-max` rule: when the player count makes the table wider than the viewport can fit alongside the 420px log column, track 1 grows to honor the table's intrinsic min-content width, the grid expands past the viewport, and `body`'s `overflow-x: auto` lets the user horizontally scroll to reach both. If track 1 were `minmax(0,1fr)` instead, the table would overflow its track to the right and visually cover the SuggestionLogPanel sitting in track 2.
- The SuggestionLog column is sticky-top only — there is no sticky-right pin. The wrapper in `PlayLayout.tsx` has a bounded `max-height` and its own internal `overflow-y-auto`. As the page scrolls vertically, the log pane stays in view; as the log's *internal* content overflows, the log scrolls inside its own frame. As the page scrolls horizontally on a wide table, the log slides out of view to the right with the rest of the grid — that's intentional, not a bug. Re-introducing a sticky-right pin (`right-5` etc.) puts the log back on top of the table contents, which is the regression to avoid.
- Banner appearing / disappearing doesn't cause a layout jump in the table or the log — the banner publishes its height as `--contradiction-banner-offset`, which `<main>`'s padding-top consumes.

**Cell-explanation row dismissal (Play mode, `Checklist.tsx` outside-click effect):**

- Tap-to-dismiss on the parchment outside the open cell + explanation row works.
- Touch-scrolling anywhere on the page does NOT dismiss the row. The dismissal effect listens for `click` (not `pointerdown`); a `click` only fires after a tap that didn't move significantly, so a drag/scroll never produces one. If you change the listener back to `pointerdown` to "fix" some other problem, scrolling the page with the row open will dismiss it again — that's the regression to avoid.
- The outside-click handler treats a tap landing inside ANY popover-interactive cell as "still engaged" — it iterates `cellNodesByKeyRef.current.values()` and short-circuits if any cell contains the target. The cell's own `onClick` then resolves the state transition (close-self / same-row swap / cross-row close / two-tap open). The handler deliberately does NOT depend on React batching its own `setExpandedCell(null)` with the cell's bubble-phase `setExpandedCell(newCell)` — mobile browsers were not reliably batching them, producing a close-then-no-reopen sequence on same-row tap. Re-introducing a per-open-cell key lookup here (so the handler dismisses on taps that land on any other cell) is the regression to avoid.
- On touch, the two-tap protocol applies for CROSS-ROW navigation only. Tapping a cell on a different row (different `card`) while one is open closes the open row but doesn't open the new one until the second tap on the now-focused cell. The pre-tap focus check in `onPointerDown` (`document.activeElement === e.currentTarget`) is what tells the cell's `onClick` whether this is tap-one or tap-two.
- Same-row tap on touch is a SINGLE-tap direct swap. Tapping a cell that shares the open cell's `card` (different owner column, same grid row) re-anchors the panel without dismissing — the row is already in context, so the second-tap dismiss gate would be pure friction.
- Long-press on touch (`LONG_PRESS_DELAY = 500ms`, `LONG_PRESS_MOVE_TOLERANCE_PX = 10`) is a SINGLE-gesture direct action. From cold it opens the long-pressed cell. With another cell's panel already open it always re-anchors the panel to the long-pressed cell — same-row case is a re-anchor; cross-row case is a close-on-old + expand-on-new driven by the single `setExpandedCell(thisCell)` commit. Long-press on the already-open cell toggles it closed (a deliberate dismiss gesture). The trailing synthesized `click` is suppressed via `wasLongPressRef` so it doesn't re-engage the two-tap state machine or close what the long-press just opened. `pointermove` past 10 px from the touch start, `pointerup`, and `pointercancel` all clear the pending timer so a scroll gesture never opens a panel. Mouse / pen pointers are gated out at the top of `onPointerDown` so the long-press code path is touch-only.
- Mouse and keyboard remain single-action: clicking, pressing Enter, or pressing Space immediately toggles the row open / closed regardless of focus history.

**Open-cell outline + related-cell highlight (`Checklist.tsx` + `globals.css`):**

- The open cell's outline is a 3-sided 3px accent ring painted on top/left/right (no bottom). Implementation lives in `.cell-expanded-focus` in `globals.css`: a `box-shadow: 0 0 0 3px var(--color-accent)` plus a `clip-path` polygon that extends `5px` outward on top/left/right and stops at `y = 100%` on the bottom — clipping the bottom of the ring so it appears 3-sided. The visual matches the standard `:focus-visible` look elsewhere on the page so the focus → open transition reads as continuous, not as a treatment swap.
- For the rightmost owner column (Case file), the cell's right edge sits flush against the explanation panel's `border-r-[3px]`. Without help, the base rule's `+5px` right extension on the clip-path lets the 3px outset box-shadow render past the cell and show as a thin vertical accent line outside the panel's rounded box. `Checklist.tsx` appends a `cell-expanded-focus-last-col` modifier on the open cell when `colIdx === totalCols - 1`. That modifier does two things: (a) the clip-path stops at `100%` on the right so the outset shadow's right side isn't drawn past the cell, and (b) an `inset -3px 0 0 var(--color-accent)` is appended to the `box-shadow` so a 3px accent strip paints INSIDE the cell at its right edge. The inset strip occupies exactly the same x-range as the explanation panel's `border-r-[3px]` (which paints from `panel.right − 3` to `panel.right`), so the cell's right side and the panel's right border line up into one continuous vertical accent line — without (b), the cell visually has only top + left edges and the panel's right border appears to start mid-air below the cell. The doubled-class selector (`.cell-expanded-focus-last-col.cell-expanded-focus-last-col`) ties the base rule's specificity (0,2,0) and wins by source order. No matching leftmost modifier is needed because the leftmost openable column (Player 1) sits inside the table, not flush against the panel's left border.
- The panel's own `border-t-[3px]` is masked under the open cell so the explanation row's accent top-border doesn't cut a 3px line across the cell's column at the seam: `openCellMetrics` measures the cell's left/width relative to the explanation row's content `<td>` and renders a `h-[3px] bg-panel` strip at that horizontal range. The mask is sized to the cell's INNER box (not extended outward by the ring) — at the bottom corners, the ring's 3px vertical column sits directly above the panel's 3px horizontal border row, forming clean L-junctions with no gap. The mask is also clamped to `left ≥ 0` and `left + width ≤ rowWidth − 3` so a leftmost/rightmost open cell can't punch a hole through the panel's left/right border.
- Related-cell highlight (`CELL_HIGHLIGHTED`) — applied to cells whose deduction provenance contributed to the open popover's value — uses a 3px **dashed** accent outline at 2px offset (`!outline-[3px] !outline-dashed !outline-accent !outline-offset-2`). The geometry deliberately mirrors the open cell's box-shadow ring so highlighted-cell outlines line up around the active cell, but the dashed style keeps them visually distinct from the solid open-cell ring. `outline` is used (not `ring`/box-shadow) because box-shadow has no dashed style and outline doesn't change the cell's box dimensions.
- Z-index: `--z-checklist-cell-hover` (20) for highlighted cells, `--z-checklist-cell-focus` (25) for the open cell. The open cell always paints over any overlapping dashed outline. When a cell is BOTH highlighted and open, `CELL_EXPANDED`'s `!outline-none` suppresses the dashed outline so only the box-shadow ring shows.

### Tour-popover verification

The tour popover system (`src/ui/tour/TourPopover.tsx`, `src/ui/tour/tours.ts`) positions a Radix popover next to a "spotlight" cutout that highlights the anchor element. jsdom can't run layout, so popover/spotlight pixel positions cannot be unit-tested — they're verified manually in the `next-dev` preview at both viewport breakpoints whenever you touch:

- `src/ui/tour/tours.ts` — step config (`anchor`, `popoverAnchor`, `popoverAnchorPriority`, `side`, `align`, `sideByViewport`, `viewport`, `anchorByViewport`).
- `src/ui/tour/TourPopover.tsx` — anchor resolution, side/align resolution, positioning effect.
- A `data-tour-anchor="…"` attribute on any DOM node — adding, removing, or moving one changes which element drives spotlight + popover position.
- `src/ui/onboarding/StartupCoordinator.tsx` precedence rules — changes which tour fires when.

**Verification rule.** For every tour the app can launch, walk every step at desktop (1280×800) AND mobile (375×812) in the `next-dev` preview. For each step:

1. **Popover fully on-screen** — `top ≥ 0 && left ≥ 0 && right ≤ vw && bottom ≤ vh`. ***Hard requirement.*** A clipped popover means the user can't read the copy or click Next, so the tour stalls.
2. **Popover doesn't cover the spotlight area** — *soft requirement.* The spotlight is the user's "look here" cue; the popover blocking it defeats the purpose. If avoiding overlap forces the popover off-screen, **prefer popover visibility** (rule #1 always wins). When overlap is unavoidable, position the popover so it covers the *less important* part of the spotlight (e.g. the top of a tall column the user is being introduced to, not the middle).
3. **No console warnings during the tour** — particularly React's "Each child in a list should have a unique 'key' prop" warning that surfaces when Radix's Slot iterates `Popover.Content`'s children. The current fix is a `<div className="contents">` wrapper; if you restructure those children, re-verify.

Sequencing and precedence are covered by `src/ui/onboarding/StartupCoordinator.test.tsx` + `src/ui/tour/screenKey.test.ts` — those tests pin which tour fires under which conditions, the splash → tour → install ordering, the brand-new-user redirect, and that completion locks the gate. **You don't need to walk those scenarios manually unless you change `TOUR_PRECEDENCE`, add a new screen to the tour registry, or touch the gate logic.** The manual walk is purely about pixel positioning.

**Enumerating the tours.** The full list of tours that can launch lives in `src/ui/tour/tours.ts` under the `TOURS` registry. Today (subject to drift — re-read the registry as the source of truth):

- **`setup`** — fires on first visit to the Setup pane. How to launch: clear `effect-clue.*` from localStorage and load `/play?view=setup`. (Brand-new users landing anywhere else get redirected here by the coordinator.)
- **`checklistSuggest`** — fires on first visit to the Play pane (Checklist + Suggest). Launch: dismiss `setup` first (e.g. seed `effect-clue.tour.setup.v1` with `lastDismissedAt`), then load `/play?view=checklist`. Step count is viewport-conditional and asymmetric today: 12 on desktop, 13 on mobile. The two-halves intro is one step on desktop (multi-spotlight on the two pane columns) but TWO on mobile (multi-spotlight on the two BottomNav tabs, then a tap-Checklist advance-on-click step). Verify the "N of M" counter matches what's visible at each breakpoint.
- **`firstSuggestion`** — fires once per 4-week window when the user logs the first suggestion of any session. Launch: clear all tour state, dismiss splash + the per-screen tours, set up a game with default players, navigate to suggest mode, and submit the form. The popover fires immediately after the suggestion is added. Step count is viewport-conditional: 1 on desktop (the "see updated deductions" callout, since both panes are visible side-by-side), 2 on mobile (tap-Checklist to navigate to the Checklist pane, then the "see updated deductions" callout against the case-file there).
- **`sharing`** — follow-up tour that opens the overflow menu and walks the three menu items inside it: Invite a player, Continue on another device, My card packs. Each step force-opens the menu via `forceOpenOverflowMenu: true` (decoupled from `anchor === "overflow-menu"` so the popover anchors to the specific menu item while the menu stays open). Has prerequisites: both the `setup` AND `checklistSuggest` tours must have been dismissed first (any path — Skip / X / completed). Launch: seed `effect-clue.tour.setup.v1` AND `effect-clue.tour.checklistSuggest.v1` with `lastDismissedAt`, leave `effect-clue.tour.sharing.v1` unseeded, then load `/play?view=setup`. Does NOT redirect off other screens.

**Interaction model.** Every step blocks the page beneath it — the dim veil absorbs clicks, the keyboard isolator swallows all non-Escape keys whose target isn't inside the popover, and the spotlight has `pointer-events: auto` so taps on the spotlit element don't reach the underlying anchor. The user navigates the tour with Back / Next / Skip / X on the popover; that's it. The exception is `advanceOn: { event: "click", anchor }` steps — those route clicks through to one specific anchor (the user is being asked to perform that action), and a window-level capture-phase click filter cancels every other click that lands outside the popover or the advance anchor.

If you add a new tour to the registry, add it to this list AND walk it at both breakpoints before merging.

**Step launchers.** When you need to ship a step deep in a multi-step tour without walking the earlier steps every time:

- The "Restart tour" overflow-menu item (in the ⋯ menu) wipes every per-screen tour-gate flag and re-fires the tour for the user's *current* screen. Useful for re-running setup or checklistSuggest without crafting localStorage by hand.
- For mid-tour steps, advance via the popover's Next button. There's no "jump to step N" affordance today — if you need one, advance with the keyboard (Tab → Tab → Tab → Enter cycles to Next).

**Drift signals.** While walking the tours, if any of these surface, treat them as bugs:

- Popover left edge < 0 or right edge > viewport width — usually a `side: "left"` / `side: "right"` step on a viewport too narrow to fit. Fix with `sideByViewport` flipping to `top` / `bottom` on the affected breakpoint.
- Popover top edge < 0 — usually `side: "top"` against a tall anchor whose top is near `y=0` (Radix tries to put it above, no room). Fix with a smaller `popoverAnchor` (a small element at a known position inside the spotlight area), or flip `side: "bottom"`.
- Popover anchored to the trigger of an open dropdown but ending up where it covers the dropdown's items — `popoverAnchorPriority: "last-visible"` resolves to the portaled menu content instead of the trigger.
- Step counter shows e.g. "5 of 5" on desktop where you expect "4 of 4" — a step's `viewport: "mobile"` (or `"desktop"`) field is missing, so `useFilterStepsByViewport` lets the wrong step through. Or vice versa.

When a layout change makes any of the requirements above fail, prefer fixing in this order:
1. Adjust `side`/`align` (or `sideByViewport`) on the affected step.
2. Adjust `popoverAnchor` to a smaller / better-positioned element if the spotlight anchor is too large.
3. Adjust `anchorByViewport` to point at a different DOM node per breakpoint.
4. As a last resort, add or remove a step.

**Tour steps must set up the UI to their expected pre-condition.** Don't rely on the previous step having left the UI in the right state — Back navigation, partial dismissals, race conditions, or the user opening the tour from "Restart tour" mid-flow can land them on a step with the UI in any state. When a step needs the explanation panel open (`cell-explanation-*` steps) or closed (cellIntro), an entry-side effect in the affected component should `setExpandedCell(targetCell)` or `setExpandedCell(null)` on transition into that step. The pattern lives in `src/ui/components/Checklist.tsx` — search for `useTour` to find the entry effects. The user's action (Next click / advance-on-click) then operates on a known starting state and does what the copy says it will.

**Advance-on-click steps on touch devices: bypass React's synthetic event with a native DOM listener.** The Checklist cell has a touch two-tap protocol (first tap focuses, second tap opens) that fundamentally breaks `advanceOn: { event: "click" }` — on the first tap, the tour advances via the click event while the cell's React onClick falls through to "focus, don't open." The fix is to attach a native `addEventListener("click", …)` on the anchor element from the consuming component, NOT to rely on the cell's React onClick. Native listeners fire on every click regardless of focus state, two-tap state, or any closure-staleness inside React's event delegation. See the `checklist-cell` / `checklist-cell-close` handling in `Checklist.tsx` for the pattern.

**Guard close paths during multi-step walkthroughs of an open panel.** When the tour walks the user through sections of an open panel (the DEDUCTIONS / LEADS / HYPOTHESIS / panel-intro chain), the panel must stay open across all of those steps. Real mobile devices (notably iOS Safari) fire "ghost" clicks ~300 ms after a tap that ended via `touchend`, and those clicks can hit the page beneath the popover. The pattern is a `tourKeepsCellOpen` predicate (a list of step anchors where the panel must stay open) wrapped in a ref so close-path effects can read the latest value without re-installing on every step change. Every place the cell can close — the cell's React onClick, the window-level outside-click handler, the explanation row's onClose — checks the ref and bails when the tour says "keep this open." See `tourKeepsCellOpen` / `tourKeepsCellOpenRef` in `Checklist.tsx`.

**Verify advance-on-click steps with delayed checkpoints (300 ms, 1 s, 2 s).** The user-facing bug we hit was a panel that opened on tap and closed ~300 ms later via an iOS ghost click — invisible in a single-snapshot test taken immediately after the tap. When verifying an advance-on-click step, take checkpoints at multiple delays and assert the UI is still in the expected state at each one. The verification harness in the preview can dispatch synthetic clicks at any time, so this is cheap to script.

**Don't rely on focus as a pre-condition.** The TourPopover auto-focuses its Next button on every step change (a `requestAnimationFrame` inside `TourPopover.tsx`). Any "pre-focus this element so the user's tap triggers behavior X" strategy gets undone — even with a double-rAF, focus is fragile. If you need a specific element to be the click target, use a native click listener attached directly to that element instead of trying to steer focus.

**Effect deps in tour-driven entry effects: prefer refs over reducer-derived state.** A `useEffect` with `state.setup` (or anything from `useClue()`) in its dep array re-fires every time the reducer produces a new top-level state object — which happens on tour advance, uiMode changes, and many other reasons unrelated to the step. If the effect's body sets cell state (e.g. `setExpandedCell(null)` to close on entry), those re-fires can clobber the user's just-opened panel. Capture the reducer-derived value into a `useRef` and dereference it inside the effect, keeping only step-transition signals (e.g. `currentStepAnchor`, `setExpandedCell` from a useState setter) in deps.

**The tour owns scroll on its own step changes; per-view scroll memory must yield.** `src/ui/scrollMemory.ts` remembers each `uiMode`'s last scroll position and restores it on view change (`src/ui/Clue.tsx`'s restore effect). When a tour step's `requiredUiMode` flips the view, both systems would race for the scroll: the per-view restore (two rAFs ≈ 32ms) overrides the tour's `scrollSpotlightIntoView` (which fires immediately, then guards itself with `scrolledForStepRef` against re-running on later recomputes). Net effect without coordination: the popover ends up anchored offscreen. The fix lives in scrollMemory's one-shot suppression API — the tour calls `suppressNextScrollRestore(mode)` immediately before its `dispatch({ type: "setUiMode", mode })`, and the restore effect calls `consumeScrollRestoreSuppression(mode)` to bail when the tour is in charge. The "decide whether to auto-set scroll on view change" decision lives in one place (the restore effect); the tour signals its intent through the suppression API rather than doing its own scroll-restore. Any future system that auto-sets scroll on view change must route through this same suppression API — don't add a parallel scroll-restore path.

## Icons

Use these icons consistently — picking the wrong glyph mis-signals what the affordance does and creates ambiguity for users on touch devices where there's no tooltip.

- **`XIcon`** — two roles, both legitimate:
  1. **Non-destructive cancel / dismiss / close.** Modal close buttons, dismiss-this-banner, clear-inputs, exit-out-of-flow. Never use for delete.
  2. **The "N" value of a checklist cell** (`CellGlyph`'s `GLYPH_NO`). The grid uses XIcon to mark "this owner does not have this card" — the visual partner of `CheckIcon` for "Y".

  Because XIcon now also carries a *value* meaning in cells, **do not use it to flag errors / problems / contradictions**. Reach for `AlertIcon` instead. Reusing X for a problem signal would conflate "this cell is N" with "something went wrong" — two unrelated meanings sharing one glyph.
- **`CheckIcon`** — the "Y" value of a checklist cell (`GLYPH_YES`), and inline confirmations ("confirmed", "saved"). Pair with `XIcon` for value semantics; pair with success copy for confirmations.
- **`AlertIcon`** — triangular warning glyph, used wherever the UI flags a problem the user needs to attend to. Contradictions, validation failures, hypothesis conflicts. Pulses (`motion-safe:animate-pulse`) when the surface is asking for immediate attention. Not for delete (that's `TrashIcon`); not for close (that's `XIcon`).
- **`TrashIcon`** — destructive delete / remove / discard. Always pair with a confirm dialog (or undo affordance) when the action is irreversible.
- **`ShareIcon`** — any "share this with someone" action. Renders the platform-aware glyph internally (Apple share-sheet on iOS / macOS, Material 3-node graph elsewhere) — callers don't need to handle the platform split.
- **`ExternalLinkIcon`** — links that open a new tab or navigate outside the app.

If you need a glyph that doesn't fit one of these, add it to `src/ui/components/Icons.tsx` (or `ShareIcon.tsx` for share variants) — don't reach for an emoji or a literal character (`×`, `→`, etc.) that might be misread.

## Terminology

A few words have specific app-wide meaning. Stay consistent in both code and user-facing copy:

- **"has" / "does not have"** — the relationship between a player or the case file and a card. The deduction grid is a matrix of these relationships; a cell value of <yes></yes> means "this player **has** this card", a <no></no> means "this player **does not have** this card", blank means "we don't know yet". Avoid "owns" / "doesn't own" and "holds" / "doesn't hold" — both read as jargon next to the plain everyday "has" / "does not have". The case file isn't a "player" but the same vocabulary applies: cards the case file "has" are the murder envelope, cards it "does not have" are in someone's hand. The same rule applies to variations of "hold" — "must hold", "is held by", "can't hold", "would hold", "the cards you're holding", and "the case file holds X" all need to become the matching "have" form ("must have", "X has", "cannot have", "would have", "the cards you have", "the case file has X").
- **Spell out contractions when describing card ownership** — write "does not have", "cannot have", "is not", "would not have" rather than "doesn't have", "can't have", "isn't", "wouldn't have". The expanded form reads more deliberate, matches the formal tone of the deduction grid's <yes></yes> / <no></no> language, and avoids the visual collision where "doesn't" gets quickly skimmed as "does" when a player is scanning a busy explanation. This rule applies wherever the copy is about a player's or the case file's relationship with a card; contractions in unrelated copy (UI affordances, status messages that aren't about ownership) are fine.
- **"Case file"** is a *section* or *area*, not a "column". On desktop the case-file summary renders as a horizontal strip above the player columns; on mobile it's the top of the page. Calling it a column reads wrong on both layouts.

Apply all three rules wherever the user is reading copy (i18n strings, error messages, tooltips, tour text). Internal variable names can keep `owner` / `ownership` as a technical term (the codebase uses the `Owner` type widely) — those names predate this rule and renaming the type for a vocabulary nicety is more churn than it's worth.

### Tour copy: use `ProseChecklistIcon` instead of "Y" / "N"

When a tour step's body refers to a cell's value, splice in `ProseChecklistIcon` via next-intl's `t.rich` rather than writing the literal letters "Y" or "N". The tour popover registers `<yes></yes>` and `<no></no>` placeholder tags that render the icons inline:

```json
"hypothesis.body": "Set the cell to <yes></yes> (has the card) or <no></no> (does not have the card) as a guess."
```

The icons match what the user sees in the deduction grid, so the tour reads in the same visual language as the rest of the app. Parenthetical clarifications ("(has the card)", "(does not have the card)") are fine when the meaning needs spelling out — the icon carries the visual signal; the words spell out the semantics.

## Sharing and sync docs

Two docs in `docs/` cover how user data leaves the device:

- [docs/shares-and-sync.md](docs/shares-and-sync.md) — the sharing UX, the kind-discriminated wire contract, and the seven Effect-Schema-validated wire fields (cardPack / players / handSizes / knownCards / suggestions / accusations / hypotheses). Hypotheses are `transfer`-only.
- [docs/card-pack-sync.md](docs/card-pack-sync.md) — the deep dive on how localStorage and the server stay in sync once the user is signed in: per-pack metadata (`unsyncedSince`, `lastSyncedSnapshot`), tombstones, the `<CardPacksSync />` reconcile loop, the `flushPendingChanges` logout chokepoint, and four "life of a card pack" timelines.

**Whenever you touch sync-or-share code, update the corresponding doc as part of the same change.** This is non-negotiable — these systems have enough subtlety (auth gating, conflict resolution, in-flight registry, tombstones, the four-quadrant pack-state matrix) that drift between the code and the doc will burn the next person to come in.

The triggering paths:

- **Sharing**: anything in `src/ui/share/`, `src/server/actions/shares.ts`, `src/logic/ShareCodec.ts`, the `shares` DB columns. Touches → update `docs/shares-and-sync.md`.
- **Card-pack sync**: `src/data/cardPacksSync.tsx`, `src/data/customCardPacks.ts`, `src/data/cardPacksInFlight.ts`, `src/data/serverPackCodec.ts`, `src/logic/CustomCardSets.ts`, `src/logic/CardPackTombstones.ts`, `src/server/actions/packs.ts`, `src/ui/account/AccountProvider.tsx`, `src/ui/account/LogoutWarningModal.tsx`, `src/ui/components/cardPackActions.ts`. Touches → update `docs/card-pack-sync.md` (and `docs/shares-and-sync.md` if the change crosses into the sharing wire format).

The three rules from `docs/shares-and-sync.md` that govern sharing and shouldn't be loosened without a deliberate change to the doc:

- **Universal sign-in.** Every share requires a real, non-anonymous user. The check lives at the top of `createShare` and the DB enforces it via `owner_id NOT NULL`. Don't reintroduce per-flow auth conditionals. The same gate (`useSignedInUserId` / `requireSignedInUser`) governs server-side card-pack mirroring.
- **Kind-based wire contract.** `createShare`'s input is a discriminated union by `kind`. The server whitelists fields per kind and rejects anything extraneous. Don't expose the column structure to the client; add new flows by adding new kinds.
- **Effect-Schema-validated wire format.** All seven wire fields go through codecs in `src/logic/ShareCodec.ts`. Don't add a new wire field with a raw `JSON.stringify` / `JSON.parse` — write a codec, route both sender and receiver through it.

The card-pack sync architecture has its own load-bearing invariants that `docs/card-pack-sync.md` covers in depth — the four-quadrant pack-state matrix (`unsyncedSince` × `lastSyncedSnapshot`), the conflict-resolution rules (local-wins when `unsyncedSince` is set, otherwise server-wins), the always-tombstone-when-signed-in delete policy, and the `clearAccountTiedLocalState` keys list. Read the doc before changing those.

## Tests

Write exhaustive tests for any code you add or modify.

When modifying behavior:

1. Read the existing tests covering that code first.
2. Remove or update tests that assert outdated behavior.
3. Add tests for any previously-uncovered cases the change introduces.
4. Run `pnpm test` and make sure everything passes.

Tests live next to source (`Foo.test.ts(x)` beside `Foo.ts(x)`) — match that pattern.

## Use `Duration` and `DateTime` for time

All durations and dates flow as Effect's `Duration` and `DateTime` types, never raw `number` (milliseconds, Unix timestamps) or `Date` objects. Convert to a primitive **only at the edge** — right before handing the value to a non-Effect API (`setTimeout`, CSS animation, persistence, third-party library).

- **Define durations declaratively:** `Duration.seconds(15)`, `Duration.minutes(1)`, `Duration.millis(180)`. Add / compare with `Duration.sum`, `Duration.greaterThan`, etc.
- **Define dates with `DateTime`:** `DateTime.now`, `DateTime.unsafeMake(...)`, `DateTime.add(...)`. Diff with `DateTime.distanceDuration` (returns a `Duration`, not a number).
- **At the edge:** `Duration.toMillis(d)` → `setTimeout`. `DateTime.toEpochMillis(t)` → JSON / persistence. `new Date(DateTime.toEpochMillis(t)).toISOString()` → ISO string. Animation libraries that take seconds (Framer Motion's `transition.duration`) → `Duration.toSeconds(d)`.

Why: `Duration.seconds(15)` reads as "15 seconds" at every call site; `15_000` reads as "fifteen thousand" with the unit implicit. Adding two `Duration`s is unit-safe; adding two `number`s is a runtime bug waiting to happen. Mixing minutes and millis is a TypeScript error, not a 60×-off latency mystery.

When you find a raw `setTimeout(fn, 15_000)`, `Date.now()`, `Date.now() - then`, or a `loggedAt: number` field while making changes, convert it as part of the change. New code uses `Duration` / `DateTime` from the start.

## Database migrations

Every database migration in `src/server/migrations/` is **forward-only and backwards-compatible**. The deployed application code is the canonical reader of the schema; migrations may never break a shape that's still in use by the rolled-out app. This is a hard rule, not a stylistic preference — the deploy pipeline can't pause between schema and code rollout.

The allowed list:

- **New tables.** Create in any state.
- **New nullable columns** (with or without a default).
- **New indexes** (created with `CONCURRENTLY` where the SQL backend supports it; not all our migrations do today, but for high-traffic tables prefer concurrent index builds).
- **New constraints** that no existing row violates (e.g. a UNIQUE on a column that's already been deduplicated by application code).

The disallowed list — every one of these requires a multi-deploy plan, NOT a single migration:

- **Dropping a column** the deployed application code still reads. The fix: deploy app code that no longer references the column, wait long enough that you're confident no rollback would need the old code, THEN deploy a migration-only commit that drops the column.
- **Renaming a column or table in place.** The fix: add the new column, dual-write from the app for a period, switch reads, then drop the old column in a separate migration after the dust settles.
- **Tightening a column to `NOT NULL` without a default.** The fix: add the column nullable-with-default first, deploy a backfill, deploy app code that always writes the column, THEN tighten to `NOT NULL` in a follow-up migration.
- **Tightening a type** (e.g. `TEXT → INTEGER` via `USING ::integer`). The fix: add a new column with the tighter type, dual-write from the app, switch reads, drop the old column.

Why so strict: Vercel doesn't distinguish "staged builds" from "deployed builds" — by the time a migration runs, the new app code is already serving traffic, and the old app code is still serving traffic from instances that haven't recycled yet. A migration that breaks either side breaks production.

A migration commit's PR description should call out:

- What it adds.
- Whether it's a single-step (forward-only addition) or a multi-step (rolling out alongside an application code change). Multi-step migrations get one migration per step, never bundled.
- For renames / drops / tightenings: which prior commit deployed the app code that no longer needs the old shape, plus the date that commit was deployed.

## Forbidden shortcuts when fixing failures

When a check (typecheck, lint, test, knip, i18n:check, build) fails, fix the *cause*, not the *symptom*. The following shortcuts are never acceptable:

- **No `as any`, `as unknown as T`, or other unsafe type casts.** A cast is only acceptable when there's a real runtime guard right next to it that proves the type. If the type system is complaining, the type system is right — narrow the type, fix the inferred shape, or add proper validation. Typed silence hides bugs that surface in production.
- **No deleting code to make a check pass.** If knip flags an export, verify it's actually unused before removing — `grep` for it across `src/` and the tests. If the type error comes from a function being called wrong, fix the call site or the signature; don't delete the function. The only time deletion is the right answer is when the *task itself* is "remove dead code" and you've verified nothing references it.
- **No removing or skipping tests to make them pass.** If a test is failing, the test is telling you something. Either the production code is wrong (fix it), the test's expectation is outdated and you understand *why* it changed (update the assertion with a comment explaining the new behavior), or the test is genuinely flaky (mark it and tell the user — don't silently `.skip`).
- **No `// @ts-ignore` / `// @ts-expect-error` / `eslint-disable` to silence errors you don't understand.** A disable comment is a promise that you investigated and the suppression is correct. If you didn't investigate, don't suppress.
- **No stubbing or no-op'ing failing code paths.** Returning `null`, `undefined`, or an empty object to make a function "type-check" or "not throw" is the same class of error as `as any` — it hides the bug behind a shape that's locally valid but semantically wrong.

If a fix would require any of the above, stop and surface the problem to the user instead of pushing forward.

## Observability and analytics

For **every change** — not just observability-flavored work — pause to think across the whole app, not just the diff:

1. **Are there events worth tracking from this change?** Look at what the new code actually does — any user action, state transition, success / failure outcome, or interesting moment a future you would want to query in PostHog. If yes, add a typed emitter in `src/analytics/events.ts` and call it at the right boundary. Never invent event names inline at the call site — every event lives in `events.ts` so renaming is a TypeScript-checked change.
2. **Does this affect an existing funnel?** The three production funnels are:
   - **Onboarding:** `game_setup_started → player_added → cards_dealt → game_started`
   - **First completion:** `game_started → suggestion_made → deduction_revealed → case_file_solved`
   - **Solver engagement:** `game_started → why_tooltip_opened → case_file_solved`

   This app is a Clue *solver*, not a Clue *game* — there's no real-life "I make my accusation" moment, and "game finished" only meaningfully happens once the deducer narrows the case file to a single suspect / weapon / room. Both signals collapse into `case_file_solved`, which fires the moment every category has exactly one candidate.

   If the change moves, removes, or renames any step, update the emitter AND call it out in the PR description so the funnel definition in the PostHog UI can be re-pointed.
3. **Is this Effect code worth tracing?** Anything heavy (deducer-class work, large derivations), I/O-bound (localStorage, fetch), or that you'd want to debug in production — wrap it in `Effect.fn("module.operation")` and run via `TelemetryRuntime` (`src/observability/runtime.ts`) so the span lands on Honeycomb.
4. **Are there new error paths?** Sentry auto-captures unhandled JS errors. For typed Effect failures we still want visibility on, `Effect.logError("...", { cause })` ships them to Honeycomb logs and adds a Sentry breadcrumb.
5. **Walk the whole flow, not just the diff.** Trace the user from page load through this change and back out. If a debug session a month from now would need an event / span / log that isn't there, add it now while the context is fresh.

The PR description should list new/changed events, funnels, and spans, and call out anything that needs configuration on the PostHog or Honeycomb dashboards.

## PR workflow

- Always open a PR. Never merge directly to `main`.
- Always merge with a **merge commit** — not squash, not rebase.
- Only merge when I explicitly ask. Sometimes I'll ask you to open the PR and I'll merge it myself. If unsure whether to merge, ask.

## Rebasing on latest `origin/main`

When I ask you to "rebase on/against latest origin/main" (or "latest remote main"):

1. **Commit any work in progress first** so the rebase has a clean tree to operate on. A separate commit before the rebase is cheaper to amend later than a partial commit mid-rebase.
2. `git fetch origin main` — pull the latest refs without touching your branch.
3. Skim `git log --oneline HEAD..origin/main` and `git log --stat <new-commits>` to understand what landed upstream. Cross-reference with the files this branch touches — that's where conflicts and silent regressions will be.
4. `git rebase origin/main`. If conflicts surface, resolve each one by hand and `git rebase --continue`. Don't `--skip` your own commit and don't `--abort` unless the conflict is truly intractable.
   - **Lockfile conflicts in `pnpm-lock.yaml` resolve themselves.** Resolve the `package.json` conflict by hand, then run `pnpm install` from the repo root — that's enough. pnpm sees the conflict markers in the lockfile, treats it as a request to re-resolve, and writes a clean lockfile that matches the resolved `package.json`. **Don't** `git checkout --theirs pnpm-lock.yaml` first; it's redundant and risks losing the dep state pnpm would have preserved. After `pnpm install` finishes, `git add package.json pnpm-lock.yaml` and `git rebase --continue`.
5. **Reapply matching upstream patterns to any new code we wrote.** If the upstream commit removed a pattern (e.g. `data-animated-focus`, `focus:outline-none`, a deprecated import), our new code added since the rebase point may still use it — search the diff and apply the same cleanup so we don't reintroduce what was just removed.
6. Re-run the full pre-commit green-check set — `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm knip && pnpm i18n:check` (assuming you've already run `nvm use` in this shell). A clean rebase is not the same as a green rebase.
7. Verify in the `next-dev` preview if anything we changed is observable in the browser.
8. Amend the rebased commit only if your fixes belong to it (style cleanup, conflict resolution). Otherwise stack a new commit.
9. If the rebase required substantial reworking, **tell me before pushing or merging** so I can re-test before it ships.
10. **Always report the rebase status when you're done.** Don't push or merge without it — I read this report to decide whether the rebase is safe to ship. The report goes in your reply to me and covers, in order:
    - **Conflicts encountered.** List every file that conflicted and one sentence on what kind of conflict it was (overlapping function rename, divergent imports, semantic clash between two new features that both modify the same hook, etc.).
    - **How each was resolved.** What you kept from upstream, what you kept from our branch, and any structural change you had to make beyond a mechanical merge (e.g. "renamed our internal `decodeServerPack` to `decodeForReconcile` so upstream's exported `decodeServerPack` could keep its name").
    - **Major code changes upstream that might affect us.** Skim the 10ish upstream commits and call out anything that touches code paths we rely on, even if it didn't conflict — new hooks we should now route through, removed patterns we should follow, schema changes, new infra. Three sentences max per item, but don't omit anything that a human reviewer should know about.
    - **Tests that changed.** Tests added by upstream that we modified (and why), tests of ours that needed updating (and why).
    - **Pre-commit results.** typecheck / lint / test / knip / i18n:check status. List the test count if it shifted.
    - **Manual verification status.** Whether you ran the `next-dev` preview, what scenarios you walked, what worked, what didn't, and whether the in-tool browser was available. If you couldn't verify, say so explicitly — don't gloss over it.
    - **Commit list after the rebase.** The output of `git log --oneline -<N>` covering at least our new commits + the upstream HEAD they sit on.
    - **Safety estimate.** A one-line confidence call on whether the rebase introduced no functional regressions, on a rough "low / medium / high" scale, with one sentence explaining what would shift the estimate. This is the line I read first when deciding whether to push.

    Sample shape (paraphrase, don't copy verbatim):

    > **Rebase report**
    > - Conflicts: 3 files. `messages/en.json` (additive, both sides added new sibling keys), `src/data/customCardPacks.ts` (we restructured the file; upstream added two new hooks at the bottom), `src/data/cardPacksSync.tsx` (upstream exported a function we'd internally renamed).
    > - Resolutions: kept our shape and slotted upstream's two hooks at the bottom; renamed our internal helper from `decodeServerPack` to `decodeForReconcile` so upstream's exported `decodeServerPack` keeps its name; merged the two i18n key sets.
    > - Major upstream changes that might affect us: …
    > - Tests: …
    > - Pre-commit: typecheck ✓ / lint ✓ / test ✓ (1180 passed, +XX from previous) / knip ✓ / i18n:check ✓.
    > - Manual verification: …
    > - Commits: <`git log --oneline -5` snippet>.
    > - Safety: **medium** — pre-commit is green but the unified-vs-split mutation-hook architectural call needs a real-browser walkthrough before push.

## Commit message format

- **Title**: imperative mood, under ~70 chars.
- **Body**: lead with a description of the change from the user's perspective. Then describe any technical details. Add any other useful context after that.

## PR title and description format

- **Title**: a cohesive, concise summary that covers all commits in the PR.
- **Description**: lead with the behavior changes from the user's perspective. At the bottom, include a log of the commits with code-oriented technical descriptions of what each one does.

**Refresh the title and description on every push.** Once a PR exists, every time you push new commits to it — whether it's a follow-up fix, a review-comment response, a rebase, an amend, or a brand-new feature stacked on the same branch — re-derive the title and description from the **actual state of the branch**, not from the previous title/description plus a mental delta. The PR's title and body should always describe what's *currently* on the branch, not what was on the branch at the moment the PR was opened.

The mechanical version:

1. After pushing, run `git log --oneline origin/main..HEAD` and `git diff origin/main...HEAD --stat` to see the full set of commits and the cumulative change.
2. Read the diff and the commit bodies. Don't just skim the latest commit — earlier commits on the branch are equally part of the PR.
3. Rewrite the title to cover the whole branch cohesively. If the scope of the branch changed (e.g. the original feature plus a tangential fix that came up during review), the title should reflect the new scope, not the original framing.
4. Rewrite the description from scratch: user-facing behavior changes at the top, commit-by-commit technical log at the bottom (regenerated from `git log`, not edited in place from the previous version).
5. Update via `mcp__github__update_pull_request` — don't ask the user to do it.

This applies even when the change you just pushed feels small ("just a typo fix"). The cost of re-reading the diff and regenerating the body is a few seconds; the cost of a PR whose description has silently drifted out of sync with the code is a reviewer trusting outdated copy and missing a real change. Always re-derive from the branch, never patch the existing body.
