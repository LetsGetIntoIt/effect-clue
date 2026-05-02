# Project conventions

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

Scripts that require `pnpm install`:

- `pnpm typecheck` — TypeScript (`tsc --noEmit`)
- `pnpm lint` — ESLint (with `eslint-plugin-i18next`)
- `pnpm test` — Vitest (run mode) / `pnpm test:watch` — Vitest watch / `pnpm test:ui` — Vitest UI
- `pnpm knip` — unused-exports audit
- `pnpm i18n:check` — orphan-key audit (`scripts/check-i18n-keys.mjs`)
- `pnpm dev` — Next.js dev server (used by the `next-dev` preview)
- `pnpm build` — static export
- `pnpm start` — serve the static export

The `next-dev` preview configured in `.claude/launch.json` runs `pnpm install && pnpm dev` itself, so previews are self-healing — but the pre-commit checks above are not. If any of them fails with a module-not-found error, run `pnpm install` first and retry.

## Verification checks

All of these must pass green before every commit:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm knip`
- `pnpm i18n:check`

If you amend or update a commit, re-run the full set — a previously-green commit can break after edits.

## Manual verification in the preview

For any change that's observable in the browser, use the `next-dev` preview (configured in `.claude/launch.json`) to exercise the change yourself before reporting the task done. Follow the `<verification_workflow>` from the system prompt: start/reload the preview, check console/network/logs, take a screenshot or snapshot as proof. Don't ask the user to verify manually.

### Layout, scroll, and animation behaviors

The structural pieces below are pinned by `src/ui/components/PlayLayout.test.tsx` (mobile mounts only the active pane; desktop mounts both side-by-side). The visual / animated / sticky-positioning pieces below **cannot** be tested in jsdom — `getBoundingClientRect` returns zeroes, `position: sticky` doesn't actually pin, `min-w-max-content` doesn't actually grow, transforms don't extend `body.scrollWidth`, and animations don't run. So when a change touches **page structure (`src/ui/Clue.tsx`, `src/ui/components/PlayLayout.tsx`), overall layout CSS (`<main>`, sticky positioning, `min-w-max`, `contain-paint`, `contain-inline-size`, the `--header-offset` variable, the `html { overflow-x: clip } body { overflow-x: auto }` rules in `app/globals.css`), or slide animations (`slideVariants`, `AnimatePresence`)**, walk this list in the `next-dev` preview before reporting done.

Resize the preview between viewports as you go — many of these regress on one breakpoint without affecting the other.

**Vertical page scroll (test at any viewport):**

- Wheel anywhere on the page advances the Checklist table — not just over the table itself. Wheeling over the header, the blank parchment around the section, the `+ add card` row, etc., all scroll the document. (The fix that this codifies — `Move scroll to the page, not an internal viewport` — relies on no ancestor having `overflow-y: auto/scroll/hidden/clip`.)
- The sticky `<thead>` stays at the viewport top once the table's natural top has scrolled past. Column labels remain aligned with their columns.
- Force a contradiction (e.g. mark the same suspect "yes" for two players) — `GlobalContradictionBanner` slides in at the top. The sticky `<thead>` sits **below** the banner (its `top:` resolves to `var(--contradiction-banner-offset, 0px) + var(--header-offset, 0px)`), not behind it. On desktop the sticky `<header>` also tucks under the banner.

**Horizontal page scroll (Setup mode, viewport ≤ ~1200 px so the wide setup table doesn't fit naturally):**

- `<main>` grows (`min-w-max`) past the viewport so the body picks up a horizontal scrollbar — that's how the user reaches the rightmost columns. Horizontal scroll is owned by **`<body>`**, not `<html>` (`globals.css` sets `html { overflow-x: clip }` and `body { overflow-x: auto }`). This is load-bearing: if `<html>` ever gains horizontal scroll, mobile Chrome inflates its layout viewport to match content width, and `position: fixed; right: 0` and `100vw` start resolving to body-edge instead of screen-edge — the BottomNav lands offscreen and the centred modals stop centring on the visible viewport. Keep horizontal scroll on body. Don't introduce per-table `overflow-x: auto` containers either; that would move horizontal scroll into an internal viewport and break the `Move scroll to the page, not an internal viewport` invariant.
- As you scroll horizontally:
  - **Desktop (≥ 800 px):** the page title `CLUE SOLVER`, the `Game setup` intro card, the card-pack row, and the hand-size warning each stay anchored to the visible left edge via `[@media(min-width:800px)]:sticky [@media(min-width:800px)]:left-{N}`. The Toolbar (Undo / Redo / `⋯`) stays in the visible top region.
  - **Mobile (< 800 px):** those same four elements scroll naturally with the page (no `sticky left-…`). Mobile Chrome's visual-viewport scrolling during a touch swipe doesn't repaint sticky-x in lockstep, so the elements would visibly trail the swipe. Letting them scroll with the page is the correct mobile UX.
  - The sticky thead horizontally scrolls **with** the table so column headers stay aligned with the columns underneath them. (Don't add `sticky left-…` to the thead — it must move with horizontal scroll.)
- The page header is vertically sticky on **both** breakpoints (`top: var(--contradiction-banner-offset, 0px); z-30; bg-bg`) so it stays pinned during downward scroll on mobile too. The `--header-offset` ResizeObserver in `Clue.tsx` publishes the header's height at every breakpoint so the sticky `<thead>`'s `top:` formula resolves correctly underneath.
- Dropping back to scroll-x = 0 places everything in its natural rest position with no jump.
- The BottomNav (`src/ui/components/BottomNav.tsx`) is `position: fixed; inset-x-0; bottom-0` — pure CSS. It must read as exactly viewport-width and pinned to the visible bottom on mobile Chrome with the wide checklist scrolled. If you ever see it stretch wider than the screen, the html/body overflow rules above have likely been broken.
- Modals (`useConfirm`, `SplashModal`) are `position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%)` — also pure CSS. Same invariant: they must centre on the visible viewport, not the document. Same root cause if they ever drift.

**Mobile Suggest pane fits the viewport (Suggest mobile, viewport ≤ 800 px):**

- Page does NOT have a horizontal scrollbar on this view — `body.scrollWidth === clientWidth`.
- The `Add a [suggestion (⌘K)] [accusation (⌘I)]` text wraps. The `+ Suggester / + Suspect / + Weapon / + Room / + Passed by / + Refuted by / + Shown card` pill row wraps over multiple rows. Nothing extends past the right edge. (`SuggestionLogPanel`'s section uses `contain-inline-size` to stop its pill row's no-wrap intrinsic size from propagating into `<main>`'s `min-w-max` calculation. If you remove that class, mobile Suggest will spill horizontally.)

**Setup ↔ Play slide animation (both desktop and mobile):**

- Trigger the slide both directions — overflow menu → "Game setup" and back, or `⌘H` / `⌘K`.
- Both panes overlap mid-flight (sync mode + opacity in `slideVariants`). There's no page-sized gap between when one pane finishes leaving and the other starts arriving — the entering pane is already moving in while the exiting pane is moving out.
- The browser's horizontal scrollbar does NOT flash during the slide. (The off-screen pane's `translateX(±100%)` would otherwise extend `body.scrollWidth` mid-animation; `contain-paint` on the slide container clips that.)
- After the slide completes, `window.scrollY` is back to 0 — switching tabs doesn't leave you mid-page.
- Setup → Checklist on a wide setup table has a small known regression: the exiting `<Checklist>` re-renders with `inSetup: false` the moment `state.uiMode` flips, so its table layout shrinks while sliding out and `<main>` resizes accordingly. This isn't fixable without changing `<Checklist>`'s API to accept `inSetup` as a prop instead of reading from state. Verify it still feels acceptable; if the user complains, the refactor is the next step.

**Mobile Checklist ↔ Suggest slide (`MobilePlayLayout`'s own `AnimatePresence`):**

- Slide runs in both directions (Checklist → Suggest goes right, Suggest → Checklist goes left — `getDirection` based on `PLAY_POSITIONS`).
- The inactive pane is **not** in the DOM after the slide — no off-screen suggestion log to find by horizontal-scrolling on mobile, no off-screen Checklist to find from Suggest. (Pinned by `PlayLayout.test.tsx` — but if you change the rendering pattern, eyeball it too because the test only checks one frame.)

**Desktop side-by-side (viewport ≥ 800 px):**

- The Checklist and the SuggestionLogPanel sit in a 2-column grid (`minmax(0,1fr) / minmax(320px,420px)` with `gap-5`).
- The SuggestionLog column is sticky-top with a bounded `max-height` and its own internal `overflow-y-auto`. As the page scrolls vertically, the log pane stays in view; as the log's *internal* content overflows, the log scrolls inside its own frame.
- Banner appearing / disappearing doesn't cause a layout jump in the table or the log — the banner publishes its height as `--contradiction-banner-offset`, which `<main>`'s padding-top consumes.

### Tour-popover verification

The tour popover system (`src/ui/tour/TourPopover.tsx`, `src/ui/tour/tours.ts`) positions a Radix popover next to a "spotlight" cutout that highlights the anchor element. jsdom can't run layout, so popover/spotlight pixel positions cannot be unit-tested — they're verified manually in the `next-dev` preview at both viewport breakpoints whenever you touch:

- `src/ui/tour/tours.ts` — step config (`anchor`, `popoverAnchor`, `popoverAnchorPriority`, `side`, `align`, `sideByViewport`, `viewport`).
- `src/ui/tour/TourPopover.tsx` — anchor resolution, side/align resolution, positioning effect.
- A `data-tour-anchor="…"` attribute on any DOM node — adding, removing, or moving one changes which element drives spotlight + popover position.
- `src/ui/onboarding/StartupCoordinator.tsx` precedence rules — changes which tour fires when.

**Verification workflow.** For each tour, walk every step at desktop **1280×800** AND mobile **375×812** in the `next-dev` preview. For each step:

1. **Popover fully on-screen** — `top ≥ 0 && left ≥ 0 && right ≤ vw && bottom ≤ vh`. *Hard requirement.*
2. **Spotlight surrounds the right anchor element(s)** — visually confirm the dimming hole encloses what the copy is referring to.
3. **Popover doesn't block the spotlight area** — *soft requirement*. If unavoidable (anchor extends past the viewport), the popover MUST cover the *less important* part of the spotlight (e.g. cover top rows of a tall column rather than the center). Popover visibility wins; partial spotlight occlusion is acceptable.
4. **No console warnings** — particularly the React 19 "Each child in a list should have a unique 'key' prop" warning, which fires when Radix's Slot iterates Popover.Content's children. Resolved today by wrapping the popover's inner content in a single `<div className="contents">`; if you restructure the children, re-verify.
5. **Step counter matches the visible viewport** — mobile-only steps (`viewport: "mobile"`) don't appear on desktop, and the "step N of M" counter reflects the post-filter list. After resizing mid-tour, the counter re-derives via `useFilterStepsByViewport`.

**Tour matrix to walk** (post-round-4):

| Tour | Desktop steps | Mobile steps | Mobile-only steps |
|------|---------------|--------------|-------------------|
| `setup` (6) | 6 | 6 | — |
| `checklistSuggest` (4 desktop / 5 mobile) | 4 | 5 | `bottom-nav-suggest` (between `checklist-case-file` and `suggest-prior-log`) |
| `firstSuggestion` (1) | 1 | 1 | — *(viewport-conditional anchor: `desktop-checklist-area` desktop, `bottom-nav-checklist` mobile)* |

**Steps with known popover/spotlight overlap** (acceptable per #3 above):

- `setup-known-cell` mobile — popover covers the top ~3 rows of the player column. Desktop sits to the RIGHT of the column (no overlap, full column visible) via `sideByViewport`.
- `firstSuggestion` desktop — anchor is the entire deduction grid (~880 px tall, exceeds viewport). Popover clamps near the top with overlap. Mobile anchors to the BottomNav Checklist tab — small, no overlap.

**Sequencing & precedence** (covered by `src/ui/onboarding/StartupCoordinator.test.tsx` + `src/ui/tour/screenKey.test.ts` — no manual walk needed unless you change `TOUR_PRECEDENCE` or add a new screen):

- Splash always wins ahead of tour and install at boot.
- After splash dismisses, the coordinator picks the highest-priority eligible tour from `TOUR_PRECEDENCE = ["setup", "checklistSuggest"]`. If that tour belongs to a different screen than the user landed on, the coordinator dispatches `setUiMode` to redirect.
- A tour completing (Next on the last step) writes `lastDismissedAt` for that screen — same gate effect as Skip / Esc / X. The 4-week re-engage cadence applies to both completion and dismissal.
- After a tour fires, install is suppressed for the rest of the session.

**Test scenarios to walk in the preview** (clear `effect-clue.*` keys in localStorage between each one):

1. **Brand-new user lands on `/`** → splash → setup tour (6 steps).
2. **Brand-new user lands on `/play?view=checklist`** → splash → coordinator redirects to `?view=setup` → setup tour fires.
3. **Returning user (setup completed) lands on `/play`** → no redirect → checklist+suggest tour (4 desktop / 5 mobile steps).
4. **Returning user with all tours completed lands on `/play`** → no tour, install prompt fires (if eligible).
5. **Resize from desktop to mobile mid-tour during `checklistSuggest`** → step counter re-derives (4 → 5 if not yet past the new mobile-only step).
6. **Tour active + try `⌘K` / arrow keys / Tab** → keyboard isolator swallows everything except `Esc` (dismiss) and keys targeting popover content (Tab between Back / Skip / Next).
7. **Tour active + click backdrop** → tour stays active. Click ⌘+wheel scroll the page → page scrolls (veil doesn't lock scroll).

When a layout change makes any of these scenarios fail, prefer fixing in this order:
1. Adjust `side`/`align` (or `sideByViewport`) on the affected step.
2. Adjust `popoverAnchor` to a smaller / better-positioned element if the spotlight anchor is too large.
3. As a last resort, add or remove a step.

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

## Commit message format

- **Title**: imperative mood, under ~70 chars.
- **Body**: lead with a description of the change from the user's perspective. Then describe any technical details. Add any other useful context after that.

## PR title and description format

- **Title**: a cohesive, concise summary that covers all commits in the PR.
- **Description**: lead with the behavior changes from the user's perspective. At the bottom, include a log of the commits with code-oriented technical descriptions of what each one does.
