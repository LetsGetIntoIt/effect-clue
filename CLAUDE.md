# Project conventions

## Package manager

Use `pnpm` for everything. Never `npm`, `yarn`, or `bun`.

## Use the right Node version

Once per shell session, run `nvm use` from the repo root — it picks the version from `.nvmrc`. With `engine-strict=true` in `.npmrc`, every other script (`pnpm install`, `pnpm test`, etc.) will refuse to run on the wrong Node version, so getting this right once at the start of a session is what unblocks everything else. You don't need to re-run it before every command in the same shell.

**Once per session, not once per command.** Run `nvm use` (and the `source` fix below if it errors) once, then run every other `pnpm` / `node` / build command on its own. Don't keep prepending `export NVM_DIR=… && source … && nvm use && pnpm …` to every command — the active Node binary stays on PATH for subsequent commands in the same session, so re-running the env setup is just noise (and extra permission prompts).

**`source ~/.nvm/nvm.sh` whenever `nvm use` fails for any reason.** The two failure modes both point at the same fix:

- `nvm: command not found` — nvm isn't on PATH at all.
- `version "vX.Y.Z" is not yet installed` even though `~/.nvm/versions/node/vX.Y.Z` exists — `NVM_DIR` is unset, so nvm can't see the installed versions. This happens in sandboxed / non-interactive shells where `.zshrc` / `.bashrc` didn't run.

In both cases run `export NVM_DIR="$HOME/.nvm" && source "$HOME/.nvm/nvm.sh"` and retry `nvm use`. Don't try to `nvm install` your way out of the second one — the version is already there, the env is just blind to it.

Most interactive shells load nvm through `.zshrc` / `.bashrc` already, so sourcing preemptively can trigger a permission prompt for no reason. Try `nvm use` first; source on any failure.

## Install dependencies

Once per shell session — and after any `package.json` / `pnpm-lock.yaml` change — run `pnpm install` from the repo root (after `nvm use`). Every script in this repo reads from `node_modules` and will error out if it hasn't been populated.

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
