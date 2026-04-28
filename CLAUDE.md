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
