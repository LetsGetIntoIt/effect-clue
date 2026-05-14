# Setup interactions + My Cards + Teach-me overhaul

## Overall context

The setup wizard, the My Cards section, the share-import flow, and the deduction surface area have grown organically and need a coordinated polish pass. Four related but independent projects, each suitable for its own session/agent. Each brief below is self-contained.

Shared touchpoints to be aware of when sequencing the work:

- **Card-selection UI** appears in Projects 1, 2, and 3. Build it once as a shared component in Project 1; Projects 2 and 3 reuse it.
- **selfPlayerId / identity** plays a role in Projects 1, 2, and 3.
- **Tours** must be updated in Projects 1, 3, and 4.
- **Shares** are touched in Project 2 and Project 4 (teach-me bit on transfers). Update `docs/shares-and-sync.md` as part of each.

---

# Project 1 — Setup wizard: card customization modal + checklist-style card selection

## Context

The setup wizard has two card-selection steps (`SetupStepMyCards`, `SetupStepKnownCards`) that use plain checkboxes by category. They don't show deduction signal, so the user can't see their hand "filling up" as they pick cards, and contradictions only become visible after leaving the wizard. Separately, the card-pack customize flow is inline in step 1 (`SetupStepCardPackCustomize`), which crowds the step and isn't reachable from the My Card Packs modal where users naturally manage packs.

The goal: a single shared "checklist-style card grid" component used by both wizard card-selection steps, plus a dedicated card-pack editor modal accessible from both the wizard and the My Card Packs modal.

## Behavior

**Card-pack customization modal:**

- Replaces `SetupStepCardPackCustomize` inline content. Step 1 keeps the pack picker; "Customize…" becomes a button that opens the modal.
- Modal supports the same operations as the inline editor today: add/remove/rename categories, add/remove/rename cards, drag-reorder, save-as-new-pack, update-existing-custom-pack.
- Reachable from My Card Packs modal — each custom pack row gets an "Edit" affordance that opens the same modal pre-loaded with that pack.
- Built-in packs (Classic, Master Detective, etc.) are read-only inside the modal but offer a "Duplicate and edit" button that creates a custom copy.

**Checklist-style card grid (new shared component, e.g. `CardSelectionGrid`):**

- Layout mirrors the play-mode Checklist: rows = cards (grouped by category), columns = players, cells = checkboxes.
- Cell **backgrounds** show **deduction-only** colors (no hypotheses): green for `Y` from the deduction-only knowledge slice, red for `N`. Unset cells have no background.
- Checkboxes remain interactive. Toggling a cell that contradicts deductions surfaces the `GlobalContradictionBanner` (the existing one) — no inline error UI in the grid.
- Per-column "Identified X of Y cards in hand" counter under each player's header. Y is the player's hand size from `firstDealtHandSizes` (or user override).
- When a column reaches `X === Y`, all remaining cells in that column auto-fill `N` (visually shown in red; the user sees their column "complete"). This is the moment the user feels the grid working for them.
- Mobile: keep the existing paginator pattern (left/right arrows, "Player N of M") for the known-cards step. The my-cards step is single-column on mobile so no paginator needed.

**Reskinned steps:**

- **`SetupStepMyCards`** — single-column grid (just the self player). Counter prominent. No-op if `selfPlayerId === null`.
- **`SetupStepKnownCards`** — multi-column grid excluding the self player (other players only). Each column has its own counter.

## Affected files

- `src/ui/setup/steps/SetupStepCardPack.tsx` — replace inline customize section with "Customize…" button.
- `src/ui/setup/steps/SetupStepCardPackCustomize.tsx` — extract editor logic into the new modal, then delete this file.
- `src/ui/setup/steps/SetupStepMyCards.tsx` and `src/ui/setup/steps/SetupStepKnownCards.tsx` — swap `PlayerColumnCardList` for the new `CardSelectionGrid` component.
- `src/ui/setup/shared/PlayerColumnCardList.tsx` — likely delete after replacement; verify no other consumers via grep.
- **New:** `src/ui/components/CardSelectionGrid.tsx` (or under `src/ui/setup/shared/`) — the shared component. Must accept props for: players to show, whether self is included, read-only flag (for future use), and current `knownCards` state.
- **New:** `src/ui/setup/CardPackEditorModal.tsx` (or similar location) — the customization modal.
- `src/ui/account/AccountModal.tsx` — add "Edit" affordance to the My Card Packs section that opens `CardPackEditorModal`.
- `src/ui/tour/tours.ts` — `setup` tour likely walks the My Cards and Known Cards steps; update screenshots/copy if step layout changes meaningfully.

## Patterns to reuse

- `src/ui/components/Checklist.tsx` — color tokens (`bg-yes-bg`, `bg-no-bg`), cell layout, category grouping. Don't fork the whole component; reuse the design tokens and structural primitives.
- `src/ui/components/CellGlyph.tsx` — Y/N visuals.
- `src/logic/Deducer.ts` + `state.derived.deductionResult` — already exposes a deduction-only knowledge slice (`foldHypothesesInto` works on a copy). Read the real-only `Knowledge` here, not the hypothesis-joined one.
- `src/ui/setup/firstDealt.ts` → `firstDealtHandSizes(setup, firstDealtPlayer)` — source of truth for hand-size denominators.
- `src/ui/components/GlobalContradictionBanner.tsx` — already wires up to deduction failures; no banner work needed.
- `src/ui/components/CardPackPicker.tsx` — existing pack-list/edit/delete UI patterns to mirror in the editor modal.

## Open questions for the implementation session

- Self-column in known-cards step: completely excluded, or shown read-only (so the user sees their full hand in context)? Default: excluded.
- Should the counter show "0 of 6" when hand size is overridden to 0, or hide the counter? Default: show.
- When the user adds a known card for another player that exceeds that player's hand size, do we block (banner) or just warn? Current setup is permissive — preserve that for consistency.
- Editor modal: support for sharing a pack from inside the modal, or keep that only on My Card Packs rows?

## Verification

- Walk the full `setup` tour end-to-end at 1280×800 and 375×812. Tour-popover spotlights still land on the right elements.
- Manually exercise the my-cards step in `next-dev`: tick cards up to hand size, confirm column fills with red automatically, confirm a tick that contradicts deductions raises the contradiction banner.
- Open the editor modal from both setup step 1 and the My Card Packs row; both should render the same UI and persist changes the same way.
- Pre-commit greens: `pnpm typecheck && pnpm lint && pnpm test && pnpm knip && pnpm i18n:check`.
- Update `docs/card-pack-sync.md` if the editor modal changes how custom packs are persisted.

---

# Project 2 — Share import: optional identity + cards-in-hand picker

## Context

Today, when a user opens an invite share, the import modal shows a summary and a single "Add to my game" CTA. Identity is set later, on the play page (`selfPlayerId === null` after import for invites). Transfer shares already carry the sender's identity. Result: invite recipients land on a play page with no identity context, then have to find the identity step in the wizard.

Goal: optionally let the receiver of an **invite** share pick "which player are you?" and "which cards are in your hand" right in the import modal. Transfer shares keep the sender's identity; no re-prompt.

## Behavior

In `ShareImportPage.tsx` modal, for **invite** shares only:

1. Existing summary block stays.
2. New optional section: "Which player are you? (optional)" — pill row of player names from the share's roster, plus a "Skip" affordance.
3. If a player is selected, a second optional section appears: "Which cards are in your hand? (optional)" — the **same** `CardSelectionGrid` component from Project 1, single-column for the selected self player, with the "Identified X of Y" counter.
4. CTA changes to **"Join this game"** (was "Add to my game"). Reuse the existing "this will replace your current game" warning pattern that already fires when applying any share over an in-progress local game; no new warning machinery needed, just gate on the same condition. Snapshot applies with `selfPlayerId` set (if chosen) and the picked cards seeded into `knownCards`.

Skipping either section is fine; behavior matches today's import path. Transfer shares ignore both new sections (sender's identity already on the wire). Pack shares (kind=pack) also ignore them — no game state to identify with.

If the new project also adds the teach-me bit to transfer shares (see Project 4), this modal gets a "Use teach-me mode" toggle for invite shares too. Off by default.

## Affected files

- `src/ui/share/ShareImportPage.tsx` — add the two new optional sections, gated on `share.kind === "invite"`.
- `src/ui/share/useApplyShareSnapshot.ts` — accept optional identity + known-cards overrides; merge into the snapshot before hydration.
- `src/logic/ShareCodec.ts` — no wire-format changes needed for this project. (Project 4 adds a `teachMode` field on transfers.)

## Patterns to reuse

- `CardSelectionGrid` from Project 1 (single-column mode).
- The pill-row pattern from `SetupStepIdentity.tsx` for the player picker.
- `useApplyShareSnapshot.ts` already builds the session from the snapshot — extend it with optional overrides rather than rewriting.

## Open questions for the implementation session

- What's the order: identity first, then cards? Or cards optional even when identity is skipped? Recommended: gate cards on identity (no self player → no point in picking cards).
- For invite shares that already include `firstDealtPlayerId`, do we want to surface that fact ("Player X was dealt first") in the import modal? Out of scope here but worth flagging.
- Multi-step modal layout vs. accordion-within-modal? Probably accordion to keep the existing single-CTA flow.

## Verification

- Open an invite share link in `next-dev`. Pick identity + a few cards, click Add to my game; verify the play page lands with `selfPlayerId` set and those cards present.
- Open an invite share, skip both new sections; verify behavior matches the pre-change import (lands on play page, identity null).
- Open a transfer share; verify the new sections are not rendered.
- Open a pack share; verify the new sections are not rendered.
- Tests: codec round-trips unchanged; new modal interaction unit tests.
- Update `docs/shares-and-sync.md` to note the import-time identity + cards affordance.

---

# Project 3 — My Cards: mobile FAB, suggestion-aware banner, always-on section

## Context

Today, `MyHandPanel.tsx` renders only when (a) `selfPlayerId !== null` AND (b) the player has at least one known card. When the gating fails, the panel is silent — the user has no entry point to set their identity or add cards from this surface. There's also no FAB on mobile; the section lives at the top of the play layout.

The user wants the My Cards section to be a persistent, always-visible affordance with proper null states, a mobile FAB entry, and a suggestion-aware banner that previews refutation/suggestion context during a draft. The collapsed state should subtly expand to show the banner during drafts.

## Behavior

**Section structure (desktop ≥800px):**

- Always rendered in its current grid slot (no gating on `selfPlayerId` or card count).
- **Null state A — no identity:** "A quick reference for cards in your hand. Which player are you?" + pill row to set `selfPlayerId`.
- **Null state B — identity set, no cards:** "No cards in your hand. [Select cards in your hand]" — the button opens a modal containing `CardSelectionGrid` (single-column, self).
- **Populated state:** Today's horizontal-strip layout, grouped by category.
- A clear collapse/expand chevron in the section header. Persisted to localStorage (existing key).
- **Persistence rule:** the section (or, on mobile, the panel — see below) is dismissed ONLY by the explicit collapse-chevron. Tap-outside does NOT dismiss; clicks landing on other UI (Checklist cells, SuggestionLogPanel, BottomNav, toolbar, etc.) leave the panel exactly as it was. This holds on both desktop and mobile and is load-bearing — the My Cards panel is a permanent reference surface, not a transient popover.

**Mobile (<800px) FAB:**

- New `MyCardsFAB` component: `position: fixed; bottom: <above-bottomnav>; left: 5` (matching BottomNav's height + safe area). Z-index above main content, below modals.
- Renders ONLY in play mode (`uiMode === "checklist" || "suggest"`). Not in setup; setup mobile keeps the My Cards interaction inside the wizard's `SetupStepMyCards`.
- Tapping opens the **mobile My Cards panel**: the same content the desktop section shows (null states, banner, card list), `position: fixed; left: 0; right: 0; bottom: <above-bottomnav>`, anchored just above the BottomNav. NOT a centered modal — it's a fixed bottom panel that visually reads as "the desktop section, pinned to the bottom." **Persistence rule: the panel stays up until the user taps the collapse-chevron in its header.** Tap-outside does NOT dismiss; the user can scroll the page, tap Checklist cells, change tabs in BottomNav, etc., while the panel remains visible. No backdrop / dim-veil — the panel sits on top of the underlying page but lets the page beneath remain interactive. Same rule as desktop above: the My Cards panel is a permanent reference surface, not a transient overlay.
- Long-press shows the title "My cards" as a transient tooltip-like overlay (custom — there are no tooltips on touch). Use the `LONG_PRESS_DELAY = 500ms` pattern from `Checklist.tsx`.
- Icon: a hand-of-cards glyph. Add to `src/ui/components/Icons.tsx` if not present; otherwise propose a candidate (deck-of-cards SVG).

**Bottom padding on mobile (load-bearing):**

- The page already reserves bottom space for `BottomNav` via `<main>`'s padding-bottom. The new FAB sits above the BottomNav, and the open mobile panel sits even higher. Both can occlude the tail of the page if `<main>`'s bottom padding doesn't grow to match.
- Update `<main>`'s mobile bottom padding to `calc(env(safe-area-inset-bottom, 0px) + <BottomNav height> + <FAB height + spacing>)` so the user can scroll the page far enough to read the last row of any section without the FAB sitting on top of it.
- When the mobile panel is OPEN, reserve additional padding equal to the panel's measured height (use a `ResizeObserver` and a CSS variable, mirroring the `--header-offset` and `--contradiction-banner-offset` pattern in `Clue.tsx` / `globals.css`). Publish the panel's height as e.g. `--my-cards-panel-offset`; `<main>`'s padding-bottom resolves the variable. When the panel is closed, the variable falls back to 0.
- Verify on a tall-content view (wide Checklist scrolled to the bottom): scroll-to-bottom shows the last row above the FAB and above the open panel, not behind them.

**Suggestion-aware banner (mobile + desktop):**

- When `state.pendingSuggestion !== null` and at least one card slot is filled, the section shows a banner at the top of its content area:
  - If the draft's `suggester` field !== `selfPlayerId`: **"You can refute this suggestion with: card-a, card-b"** — listing intersection of draft cards with self's hand. If intersection is empty, "You cannot refute this suggestion."
  - If the draft's `suggester` field === `selfPlayerId`: **"You are suggesting from your hand: card-a"** — listing draft cards that are in self's hand. If no overlap, hide the banner (suggesting nothing from your hand is the common case; no point showing an empty banner).
- The banner is the existing `RefuteHint` logic relocated and extended. Remove `RefuteHint` from `SuggestionForm.tsx`/`MyHandPanel.tsx`'s old position.

**Collapsed-during-draft mechanic:**

- When collapsed AND a draft is active AND the banner has content to show, the section expands to a "banner-only" size showing just the banner (no card list).
- Tapping the banner expands the section fully to show the cards. Tap collapse-chevron to return to fully collapsed. (Same persistence rule — only the chevron collapses.)
- Bounce animation: when transitioning from "fully collapsed" → "banner-only" (i.e., when a draft starts or the banner first has content), play a one-shot bounce on the banner to draw attention. Use Framer Motion; reuse easing tokens from existing slide animations.

## Affected files

- `src/ui/components/MyHandPanel.tsx` — remove gating, add null states, add banner, add suggestion-aware logic, add bounce animation.
- **New:** `src/ui/components/MyCardsFAB.tsx` — the mobile FAB + bottom-sheet/modal.
- `src/ui/components/PlayLayout.tsx` — render the FAB on mobile in play mode.
- `src/ui/components/SuggestionForm.tsx` — remove the embedded `RefuteHint` (now lives in `MyHandPanel`).
- `src/ui/components/Icons.tsx` — add hand-of-cards glyph if needed.
- `src/ui/tour/tours.ts` — `checklistSuggest` tour likely has a step on the suggestion form's refute hint; update to point at the new banner location.
- `src/ui/onboarding/StartupCoordinator.tsx` — no changes expected, but verify the tour-precedence still makes sense.

## Patterns to reuse

- Long-press: `LONG_PRESS_DELAY` + `LONG_PRESS_MOVE_TOLERANCE_PX` from `Checklist.tsx`.
- Fixed positioning + safe-area: `BottomNav.tsx`'s `position: fixed; inset-x: 0; bottom: 0; [padding-bottom:env(safe-area-inset-bottom,0px)]`. FAB sits above BottomNav — use `bottom: calc(env(safe-area-inset-bottom, 0px) + <BottomNav height> + 12px)`.
- localStorage collapse state: keep the existing key (`effect-clue.my-hand-panel.collapsed.v1`); add a separate transient state for the in-draft "banner-only" expansion (don't persist this).
- Bottom-sheet pattern: search for existing modal/sheet components (`SplashModal`, share modal) and reuse styling.
- Bounce animation: Framer Motion `animate` with a spring transition; reference existing `slideVariants` for token consistency.

## Open questions for the implementation session

- Mobile bottom-sheet vs. full modal vs. expanded floating panel for the FAB's tap target? Recommend bottom-sheet to feel native, but Clue Solver doesn't have one yet.
- What's the FAB's visibility behavior during a draft? Show the same banner-snippet floating above the FAB? Or just keep the FAB and require a tap to see the banner? Default: FAB stays as-is; banner only inside the section/sheet.
- Does long-press also trigger on desktop (mouse-down hold)? Default: touch-only, matching the Checklist long-press gate.
- "Select cards in your hand" button in null state B — opens a modal containing `CardSelectionGrid`, or routes to setup wizard's `myCards` step? Recommend modal so the user stays in play context.

## Verification

- Mobile play mode: FAB visible bottom-left, BottomNav visible bottom-center/right, no collision.
- Setup mobile: no FAB. Wizard's My Cards step is the only entry.
- Desktop: no FAB, section visible in its grid slot.
- Mobile, panel CLOSED, scroll to bottom of a tall page: last row of content sits above the FAB and BottomNav, not behind them.
- Mobile, panel OPEN, scroll to bottom of a tall page: last row of content sits above the open panel, not behind it. Closing the panel restores the smaller padding and the scroll position remains sensible.
- Null state A: clear identity → section shows player picker.
- Null state B: identity set, no cards → section shows "Select cards" button → modal opens → can add cards.
- Start a suggestion draft as a non-self player: banner shows "You can refute with:" with intersection. As self player: banner shows "You are suggesting from your hand:" or hides if no overlap.
- Collapse the section, start a draft: section expands to banner-only with bounce. Tap banner: full expand. Tap chevron: full collapse.
- Persistence: open the mobile panel; scroll the page, tap a Checklist cell, switch BottomNav tabs and back — the panel is still open. Only tapping the collapse-chevron in the panel's header closes it. Same check on desktop: tapping anywhere outside the section does not close it; only the chevron does.
- Walk `checklistSuggest` tour at both viewports; verify banner-step still spotlights correctly.
- Pre-commit greens including new tests.

---

# Project 4 — Teach-me mode

## Context

Today the app proactively shows all deductions, hypotheses, leads, suggested cards, and the explanation panel — great for power users, overwhelming for someone who wants to **learn** Clue deduction by doing the work themselves. The user wants a "teach me" mode that strips out all of those AI-assistive affordances and gives the user full control of the checklist, with a way to check their work.

This is per-game (not a user preference), set at game start, toggleable later, transferable via transfer shares (but not invite or pack shares), and called out in the relevant tours.

## Behavior

**Entering teach-me mode:**

- New final wizard step: `SetupStepTeachMode` (skippable; default off). One toggle: "Teach me as I solve." Helper text explains: "Solve the puzzle yourself. We'll hide deductions, hypotheses, and hints until you ask us to check your work."
- Overflow menu (⋯) gets a "Teach me mode" toggle. Reads `state.teachMode`; dispatches to flip it.
- Persisted as a new boolean `teachMode: boolean` on `ClueState`.

**What changes when teach-me is ON:**

- **Checklist cells are user-controlled.** All Y/N values come from the user clicking. The deducer still runs in the background (we need it for the "check" feature), but its output is NOT rendered into cell visuals.
- **Hidden affordances:**
  - Hypothesis control row in the explanation panel — gone.
  - Suggested cards in `MyHandPanel` and `BehavioralInsights` — gone.
  - Leads (footnote suggestion references) — gone.
  - "Why" auto-reasoning (the deduction headline + givens + reasoning sections) — gone, replaced by the "check this cell" affordance.
  - Recommendations from the suggestion form (suggested cards in dropdowns) — show all cards alphabetically, no scoring.
- **What stays:**
  - Cells are still clickable Y/N toggles.
  - Suggestion / accusation logging is the same (it's the user's source of facts).
  - The cell explanation panel still opens, but its body is replaced (see below).
  - The contradiction banner still fires when the user's manual entries are objectively contradictory (e.g., two players marked Y for the same card).

**Cell verdict taxonomy (used by every check affordance):**

The deducer (real-only knowledge) classifies every cell into one of four states relative to what the user has entered. Use this taxonomy consistently across the global check, the per-cell check, and any future surfaces:

1. **Verifiable** — user entered Y or N, and the deducer independently proves the same value from the evidence. Copy: "You're right — this is provable from the evidence." Show the reasoning chain (the same provenance chain `cellWhy.ts` builds today).
2. **Falsifiable** — user entered Y or N, and the deducer proves the opposite value. Copy: "This contradicts the evidence." Show the reasoning that proves the opposite.
3. **Plausible-but-unsubstantiated** — user entered Y or N, and the deducer can neither prove nor disprove it from current evidence. Copy: "This could be true, but there's no proof yet — keep gathering clues." Briefly explain WHAT evidence would be needed (e.g., "If a future suggestion forces this player to refute with a specific card…").
4. **Missed deduction** — user left the cell blank, but the deducer can prove a value (Y or N) from current evidence. Copy: "You missed one — this can be deduced." Show the reasoning. (This is the case the user explicitly called out: blank cells the user didn't get.)

**Check-your-work UX (all three affordances coexist, sharing the taxonomy above):**

1. **Global "Check" button** in the play-mode toolbar. First press: vague feedback — toast or inline banner with one of: "Looking good — every cell is consistent with the evidence" / "Some cells contradict the evidence" / "You've missed some deductions" / "Some entries aren't yet supported by the evidence." (Multiple categories combine into one summary line.) No locations or reasons given. Re-press within N seconds (or via a "Show me where" affordance on the banner): full reveal — falsifiable cells outlined in red, missed-deduction blank cells outlined in a distinct color, plausible-but-unsubstantiated cells outlined in yet another color, verifiable cells unmarked. Tapping any outlined cell opens the explanation panel with the appropriate verdict copy. The user can dismiss the reveal to return to a clean board.
2. **Per-cell "Check this cell" button** in every cell explanation panel. Reveals just that cell's verdict against the taxonomy. No global state change. Available on blank cells too (so the user can ask "is this missable?").

The vague-first design preserves the puzzle. The full-reveal is escape-hatch. Per-cell is the slow drip.

**Transfer share integration:**

- New field on the transfer wire: `teachMode: boolean`.
- Add a codec entry in `src/logic/ShareCodec.ts`, an `ALLOWED_KEYS_FOR.transfer` whitelist entry, and a column in the migration.
- On the import modal (transfer shares): show the field on the summary line ("Includes teach-me mode: on"). Receiver inherits it; can toggle off after.
- **Invite shares**: don't include `teachMode` on the wire (it's a personal preference), but the import modal can offer "Use teach-me mode" as a checkbox for the receiver to opt in.
- **Pack shares**: ignore — no game state to flag.

**Tours:**

- Update `setup` tour: add a step on the new teach-mode step.
- Update `checklistSuggest` tour: when in teach-me mode, several steps about hypotheses/leads need to be filtered out. Use the existing `useFilterStepsByViewport` pattern, extended with a "filter by teach-mode" predicate, OR add `requiredMode` step config.
- Update `sharing` tour or add a new step: call out the teach-mode toggle in the overflow menu.

## Affected files

- `src/logic/ClueState.ts` — add `teachMode: boolean` (default false). Migration of localStorage shape may be needed.
- `src/ui/state.tsx` — reducer action `setTeachMode`.
- **New:** `src/ui/setup/steps/SetupStepTeachMode.tsx` — wizard step.
- `src/ui/setup/wizardSteps.ts` — register the new step as the final step (after `inviteOtherPlayers` or before it; recommend before so invites can include teach-me).
- `src/ui/components/Toolbar.tsx` — add the "Check" button (play mode only, gated on `teachMode`).
- `src/ui/components/Checklist.tsx` — gate cell rendering paths on `teachMode`; user-controlled Y/N when on, deduced when off.
- `src/ui/components/CellExplanationRow.tsx` — replace body with a "check this cell" affordance and verdict UI when teach-mode is on.
- `src/ui/components/HypothesisControl.tsx` — render-suppress when teach-mode is on.
- `src/ui/components/MyHandPanel.tsx`, `src/ui/components/BehavioralInsights.tsx`, `src/ui/components/SuggestionForm.tsx` — hide recommendation rendering when teach-mode is on.
- `src/ui/components/BottomNav.tsx` (overflow menu) — add the toggle.
- `src/ui/share/ShareImportPage.tsx` — surface the field on transfer-share summary; add the optional checkbox on invite-share import.
- `src/logic/ShareCodec.ts` — new `teachMode` codec for transfers; allowed keys; reject on invite + pack.
- `src/server/migrations/` — new forward-only migration adding a nullable `teach_mode` column on transfer shares.
- `src/ui/tour/tours.ts` — new step + filtering logic.
- `docs/shares-and-sync.md` — add `teachMode` to the wire-fields table (transfer-only).
- `AGENTS.md` — bump the wire-field count (12 fields now).

## Patterns to reuse

- `src/logic/Hypothesis.ts` + `foldHypothesesInto` — already shows how to compute deduction-only knowledge; the "check" feature can compare user-entered cells to this canonical deduction.
- The "five-bucket recipe" in `AGENTS.md` — `teachMode` is bucket 4 (personal preference / scratchwork), transfer-only.
- `src/ui/components/GlobalContradictionBanner.tsx` — already fires on objectively contradictory user input; no extra work needed.
- The tour-filtering pattern (`useFilterStepsByViewport`) — extend with a teach-mode filter rather than building a new system.

## Open questions for the implementation session

- Vague-feedback debounce: how long until "re-press for full reveal"? Suggest 3 seconds; tune in preview.
- Three reveal outline colors (falsifiable / missed / plausible-but-unsubstantiated): pick from the existing token palette to avoid new color tokens. Falsifiable likely uses the no/red token; the other two need distinct accents — propose candidates in the implementation session.
- When user toggles teach-me ON mid-game with cells already filled by deductions: do we clear all cells, keep them, or prompt the user? Recommend prompt: "Clear deductions and start fresh, or keep what we found?"
- When teach-me is ON and the user enters a value that matches the deducer's conclusion, do we silently agree (still show user's Y) or visually distinguish ("you got this one right")? Default: silent until they hit Check.
- Effect on metrics/funnels: should we emit a `teach_mode_enabled` event and gate the "first completion" funnel on teach-mode separately? Worth thinking through.

## Verification

- Start a fresh game; complete setup with teach-me ON; verify checklist starts blank, no hypotheses panel, no suggested cards, no leads.
- Make a contradictory entry; verify `GlobalContradictionBanner` fires.
- Press Check (no contradictions, but several wrong cells): get vague feedback. Press again or "Show me where": full reveal.
- Open a cell's explanation panel; press "Check this cell": get one of the four taxonomy verdicts (verifiable / falsifiable / plausible-but-unsubstantiated / missed deduction). Verify on a blank cell that the deducer CAN prove — should classify as "missed deduction."
- Toggle teach-me OFF mid-game from the overflow menu: deduction-driven cells re-appear; explanation panel returns to normal mode.
- Send a transfer share with teach-me ON; receive it; verify the new field surfaces in import summary, snapshot lands with teach-me set.
- Send an invite share with teach-me ON; verify the field is NOT on the wire; the receiver's import modal offers the optional toggle.
- Walk the `setup`, `checklistSuggest`, and `sharing` tours at both viewports with teach-me on and off.
- Pre-commit greens; new migration tested; codec round-trip tests cover `teachMode`.
- Update `docs/shares-and-sync.md` and bump the wire-field count.
