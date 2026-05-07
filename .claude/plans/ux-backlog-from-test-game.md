# UX backlog — issues surfaced by test-game playthrough

## Context

After playing a test game with real users, several UX gaps surfaced. Users
struggled with onboarding (the setup checklist was too dense), didn't realize
the Checklist ↔ Suggest panels were the two main views to swap between, and
hit friction in the suggestion form. The user wants every issue captured here
as a tracked backlog. **Nothing is being implemented yet** — this file is the
shared record so each item can be picked up individually later.

Each item below has: a short summary of the user-visible problem, the desired
behavior, and the files most likely to change. Items are ordered roughly by
the user's narration order, not priority.

---

## 0. Open questions / areas needing further investigation

Several decisions cut across multiple items and should be settled before
implementation so the work stays consistent. Resolve these first.

### 0a. Tour rework strategy

The setup tour and the `checklistSuggest` tour both lean on UI structures
that are about to change — #1 replaces the setup checklist with a wizard,
#9 needs a more prominent swap-between-tabs callout (tour-only, no UI
changes), #3 stops "go to setup" being the primary path for "I saw a
card", and #7 moves Undo / Redo into the overflow menu. Before
implementation, walk every existing tour step and decide:

- Which steps survive as-is, which need new anchors, which are deleted,
  which are added.
- For #9: where in `checklistSuggest` does the swap-between-tabs callout
  fit, and what copy + spotlight makes the concept obvious? This may be
  multiple steps (one introducing both views, one demonstrating the
  swap, one for the keyboard shortcut).
- For the new wizard (#1): each step component will likely need its own
  tour anchors / `data-tour-anchor` attributes for in-step guidance —
  particularly to communicate "enter players in turn/dealing order" and
  "skipping who-are-you disables some features".
- For #3 (cell-popover "I saw this card" entry): a tour step pointing at
  the popover so users know to record sightings inline.
- "Restart tour" must reach the new steps.
- Adding a tour step has cost (manual verification at both breakpoints
  per CLAUDE.md → "Tour-popover verification"). Prefer reworking
  existing steps when possible.

This is the **first item to land** — without a concrete tour plan,
several items risk regressing the onboarding flow.

### 0b. Where to store partially-entered suggestion drafts (#12)

LocalStorage vs query params vs hoisted in-memory state — tradeoffs in
#12 itself. Recommendation to validate: lift into the existing reducer
+ localStorage persistence layer for free per-game scoping. But
confirm by reading the persistence layer in `src/data/` before
committing to that path.

### 0c. Desktop vs mobile presentation for the wizard (#1)

Several wizard steps have UX patterns that don't translate cleanly
across breakpoints. Decisions to make before building per-step
components:

- **Drag-and-drop reorder** for players (wizard steps 1 and 3). Mouse
  DnD libraries don't always feel right on touch. Pick one library that
  handles both. Lean: `framer-motion`'s `Reorder` (already a dep) if it
  covers the use case; fall back to `@dnd-kit/core` with pointer + touch
  sensors. Pair with explicit up/down arrow controls for keyboard a11y.
- **Swipe left/right between players** on the known-cards step. Touch
  native, but needs a desktop equivalent (arrow keys, paginator buttons,
  side-by-side columns, etc.).
- **Wizard shell shape.** Desktop has room for a stepper sidebar showing
  all steps and which is active, with the ability to jump to any step
  for editing. Mobile probably wants a full-screen pane per step with
  prev/next + a compact "step N of M" indicator. Decide the shell
  before building per-step components.

### 0d. Known-cards step structure (#1, step 4)

Reuse a simplified `<Checklist>` (just the user's column) vs a
brand-new focused component? The existing checklist cell carries a lot
(deductions, popovers, leads, status glyphs) that's overkill for setup.
Lean: new focused component that visually echoes the checklist (one
column of checkbox rows, swipeable on mobile to reach other players),
not a literal reuse. Confirm during implementation by trying both for
20 minutes and picking the simpler.

### 0e. Drag-and-drop library choice

Used by player-entry and hand-sizes steps. Pick one library, don't
fork. See 0c above — lean toward `framer-motion`'s `Reorder`.

### 0f. Hypotheses copy audit (#13)

Find every user-visible "Hypothesis" / "Hypotheses" string before
rewriting (`messages/en.json` has multiple — popover.groupLabel,
hypothesisLabel, selectedHelp*, banner titles). Some are state
descriptions ("plausible so far", "confirmed") that should keep the
word; others are section headers / CTAs that the user wants reworded.
Map every occurrence first, then decide which to change.

### 0g. Communicating turn/dealing order to the user (#1)

The wizard's player-entry step assumes turn/dealing order so the
hand-sizes step can default uneven sizes correctly and the suggestion
form can default the next suggester. The user's intent: make this
clear at entry time so we don't re-prompt later. Decide on the copy
treatment (helper text under the input? a tooltip? a one-time
explainer above the list?) before building.

---

## 1. Step-by-step game-setup wizard

**Today.** Setup is a single dense table view (`<Checklist inSetup={true}>`)
where users edit players, hand sizes, their own cards, and known
other-player cards all at once.

**Wanted.** A wizard with one step per concern, each step its own
component so a user later editing a game can jump directly to a single
step from the play-mode summary (#2). The wizard replaces the
checklist's setup mode entirely — see "Checklist cleanup" at the bottom
of this item.

**Step 1: Who are the players?**

- A list of text inputs for player names.
- **Drag-and-drop reorder** (see 0c, 0e). Players should be entered in
  turn/dealing order — make this **clear at entry time** with helper
  copy (see 0g). Turn order feeds the hand-sizes defaults (step 3) and
  later flows.
- Add / remove players inline. Validation echoes today's
  `PlayerNameInput` (Checklist.tsx ~lines 2046–2190): no duplicate
  names, no empty names.

**Step 2: Who are you? (skippable)**

- A simple picker letting the user select themselves from the list of
  players entered in step 1.
- **Skippable.** Skipping disables features that depend on knowing the
  user's identity:
  - "My cards" panel (#5)
  - "You can refute with X, Y, or Z" hint during suggestion entry (#5)
  - Future "you should refute with X" deduction-driven hint
- The skip should make the disabled features obvious so the user
  understands the tradeoff. Possibly a small explainer next to the
  Skip button listing what gets gated. Decide during implementation.
- Introduces a new `selfPlayerId` field in game state. Other items (#3
  cell-popover "I saw a card", #5 my-cards panel) consume it.

**Step 3: How many cards does each person have? (skippable)**

- Shows the **default hand sizes per player**, calculated from the
  deck size and player count.
- A **"first player dealt" toggle** (or selector — see 0g) so the
  default knows how to portion uneven hand sizes (e.g. 21 cards / 4
  players → 6/5/5/5 with the first dealt-to player getting the extra).
  This relies on turn/dealing order from step 1.
- The user can override any individual hand size manually.
- **Skippable** — if the user trusts the defaults, just hit Next.
- This screen also allows **drag-and-drop reorder of players** in case
  the user got the order wrong in step 1. Reuses the same DnD library
  picked in 0e.

**Step 4: Which cards do you have?**

- Primary affordance: a **single-column checkbox list** of every card
  in the deck, the user checks the cards they were dealt.
- See 0d on whether to reuse a simplified `<Checklist>` or build a
  focused component.
- **Secondary** (after primary lands): swipe left/right (or
  desktop-equivalent paginator) to access columns for other players,
  for the next step's purpose.

**Step 5: Do you know any other player's cards? (skippable)**

- Same UI pattern as step 4, but for OTHER players' columns. Likely
  the swipe / paginator from step 4's secondary affordance.
- Skippable — most users won't have started the game yet and won't
  know any other player's cards.

**Files most likely to change:**

- New: `src/ui/setup/SetupWizard.tsx` (shell — stepper, prev/next,
  jump-to-step), `src/ui/setup/SetupStepPlayers.tsx`,
  `src/ui/setup/SetupStepIdentity.tsx`,
  `src/ui/setup/SetupStepHandSizes.tsx`,
  `src/ui/setup/SetupStepMyCards.tsx`,
  `src/ui/setup/SetupStepKnownCards.tsx`. Names approximate.
- `src/ui/components/Checklist.tsx` — extract the setup-only sub-UIs
  into shared building blocks the wizard can reuse (player-name
  validation logic, hand-size validation). The wizard does NOT reuse
  the table layout.
- `src/ui/Clue.tsx` — `state.uiMode === "setup"` renders the wizard
  instead of `<Checklist inSetup>`.
- State: a new `selfPlayerId` in the reducer, plus a "first dealt
  player" pointer if we go that route in step 3. Likely
  `src/logic/`.
- i18n keys for all step copy — `messages/en.json`.
- Tour: `src/ui/tour/tours.ts` setup tour reworked per 0a.

**Checklist cleanup (falls out of this item):**

Once the wizard ships, `<Checklist>` no longer needs to render setup
mode. **Remove** the `inSetup` prop / `uiMode` branching from
`Checklist.tsx` entirely. Concrete things that can go:

- The `inSetup ? ... : ...` branches throughout (e.g. line 920, line
  877–918 setup-info card, line 886–905 "Start Playing" button, the
  add-player `+` cell at line 1000, the inline hand-size input at
  lines 1053–1091, the "edit category" inline edits / remove buttons
  at lines 1123–1176, the inline-row "I own this card" checkboxes at
  lines 1306–1550 if their only path was setup mode).
- The `Checklist` becomes hardcoded as a play-mode hypothesis grid.
- This is significant cleanup — file size should drop noticeably.
  Treat it as a follow-up commit, not bundled with the wizard ship.

**Tests:** wizard navigation (prev/next, jump-to-step), per-step
validation, `selfPlayerId` reducer field, the "first dealt player"
default math for uneven hand sizes, drag-and-drop reorder.

---

## 2. Setup info on a single page in play mode (no checklist)

**Today.** Once the game starts, setup info isn't shown at all in play mode.
To see/edit it the user has to go back to the setup screen via `⌘H` or the
overflow menu.

**Wanted.** A read-at-a-glance summary of all setup info (players, hand
sizes, your cards, known other-player cards) visible in play mode. Tapping
any piece opens an editor for just that field.

**Files most likely to change:**

- New: a `SetupSummary` component, probably rendered above or alongside
  `<Checklist>` / `<SuggestionLogPanel>` inside `PlayLayout.tsx`.
- The per-field editors should be small focused popovers (likely Radix, to
  match the existing `CellWhyPopover` pattern).
- `src/ui/components/Checklist.tsx` — once #1 ships, the play-mode
  checklist shouldn't render setup-mode controls at all (`inSetup` branch
  goes away).

---

## 3. "I saw player X's card" moves into the cell popover

**Today.** Users navigate back to setup mid-game to record "I just saw
player X's card Y". The setup screen is the only place they can do that
manually.

**Wanted.** The most common mid-game data-entry case (recording a
sighting) happens **inline in the cell popover** for the relevant
(card × player) cell — no need to leave the play view.

The Game Setup screen itself **stays accessible** via the overflow menu
(as it is today) for the rare case of fixing an actual setup mistake
(wrong hand size, mistyped player name, etc.). The change is about
removing setup as the *primary* path for an extremely common
operation, not removing the screen.

**Files most likely to change:**

- `src/ui/components/CellWhyPopover.tsx` — add a "mark as seen by me" /
  "I saw this card" action in the Hypothesis section.
- `src/ui/components/Toolbar.tsx` and `src/ui/components/BottomNav.tsx` —
  the "Game setup" entry stays in the overflow menu unchanged. Verify
  copy and placement still feel right post-#1.
- `Cmd+H` to setup stays as a power-user affordance.
- Tour: per 0a, add a step pointing at the cell popover so users know
  the sighting-entry path lives there.

---

## 4. Bigger pills in the Suggestion form

**Today.** Pills in `SuggestionPills.tsx` (line ~232) use:
`px-3 py-2 text-[13px]`. Users found them small and fiddly to tap.

**Wanted.** Larger touch targets — bigger padding, bigger text. Specific
sizing TBD when implementing; aim for ~44px min tap target on mobile.

**Files most likely to change:**

- `src/ui/components/SuggestionPills.tsx` (~line 232 — base pill classes).
- Re-walk both the mobile and desktop suggest views per CLAUDE.md's
  "Mobile Suggest pane fits the viewport" verification list — bigger
  pills risk pushing the mobile suggest layout horizontal.

---

## 5. "My cards" bottom panel + "You can refute with X/Y/Z"

**Today.** No "my cards" UI exists. No "you can refute with…" prompt
exists. The app doesn't even know who the user is (see #1 step 2).

**Wanted.**

- A persistent bottom panel showing the cards the user holds, easy to
  glance at without leaving Suggest or Checklist.
- When a new suggestion (one targeting the user) is being entered, show a
  clear hint like "You can refute with: X, Y, or Z" derived from the
  user's hand intersected with the suggested triple.

**Depends on:** #1 step 2 (self-identify) — without `selfPlayerId` we
can't compute which cards are "mine".

**Files most likely to change:**

- New: a `MyHandPanel` component, mounted in `PlayLayout.tsx` (likely as a
  fixed-bottom or sticky-bottom region; coordinate with existing
  `BottomNav.tsx` so they don't collide on mobile).
- `src/ui/components/SuggestionForm.tsx` — add the "you can refute with…"
  computed hint, derived from `selfPlayerId` + user's known cards +
  current form's three suggested cards.
- New i18n keys for the hint copy.

---

## 6. All options always selectable in the Suggestion form (auto-deselect on conflict)

**Today.** `SuggestionForm.tsx` filters options dynamically:
`suggesterOptions` (line 927), `passersOptions` (line 947),
`refuterOptions` (line 965) each remove already-used players from the
candidate list. So if you accidentally selected a player as refuter and
then want them as a passer, they don't appear in the passers list — you
have to clear the refuter first.

**Wanted.** All options remain selectable everywhere. Picking a player in
a new role auto-removes them from the previous incompatible role, with a
small visual cue so the user notices what got cleared.

**Files most likely to change:**

- `src/ui/components/SuggestionForm.tsx` — replace
  `suggesterOptions` / `passersOptions` / `refuterOptions` filter logic
  with select-handlers that move the player between roles.
- `src/ui/components/SuggestionPills.tsx` — possibly a brief "moved from
  refuter → passer" toast / inline note. Decide during implementation.
- Tests in `SuggestionForm.test.tsx` (if it exists; otherwise add one)
  pinning the swap behavior.

---

## 7. Move Undo / Redo into the overflow menu

**Today.** Undo and Redo render as standalone buttons in
`Toolbar.tsx` (lines 138–161) and `BottomNav.tsx` (mobile).

**Wanted.** Both move into the `⋯` overflow menu so the toolbar stays
focused on primary affordances.

**Files most likely to change:**

- `src/ui/components/Toolbar.tsx` — remove the two buttons (lines
  138–161); add Undo / Redo entries in the menu items block (lines
  175–246), gated by `canUndo` / `canRedo`.
- `src/ui/components/BottomNav.tsx` — same treatment for mobile.
- `src/ui/components/OverflowMenu.tsx` — already supports menu items;
  no structural change expected.
- Keyboard shortcuts (`⌘Z` / `⌘⇧Z`) keep working — only the visual
  button is moving.
- Tour: re-walk the setup and checklistSuggest tours after this — if any
  step anchored to undo/redo it'll need to follow them into the menu.

---

## 8. Prior-suggestion text: explicitly call out unseen card and "nobody passed"

**Today.** In `SuggestionLogPanel.tsx`, `refutationStatus()` (line ~496)
maps to one of six i18n keys: `refutedSeenPassed`, `refutedSeen`,
`refutedPassed`, `refuted`, `nobodyPassed`, `nobody`. The pill values use
`popoverNoShownCard` ("Unknown / unseen") and `popoverNobodyPassed`
("Nobody passed"), but the inline description text doesn't always
mention these explicitly.

**Wanted.**

- When the shown card is unseen (refuted but card not seen by user), the
  description sentence should explicitly say so — e.g. "Refuted by Alice
  (card not seen)" rather than just "Refuted by Alice".
- When nobody passed before the refuter / nobody passed at all, that
  should also be explicit in the sentence — e.g. "Nobody passed; refuted
  by Alice".

**Files most likely to change:**

- `src/ui/components/SuggestionLogPanel.tsx` — `refutationStatus()` and
  the keys it returns.
- `messages/en.json` — update the `refutationLine` template strings for
  the affected six keys (likely the wording, not the key names).
- Tests in `SuggestionLogPanel.test.tsx` (if present) covering each of
  the six branches.

---

## 9. Make Checklist ↔ Suggest swapping more discoverable (tour-only)

**Today.** On mobile, the BottomNav (`BottomNav.tsx` lines 83–99) has
Checklist / Suggest tabs as the primary swap affordance. On desktop
both panels render side-by-side. Test users didn't realize they were
meant to flip back and forth — they treated whichever they landed on
as "the app".

**Wanted.** Make the swap-between-two-panels concept obvious through
the **tour only**. Don't change UI affordances — the tabs and
side-by-side layout are fine; the issue is purely that the user wasn't
told the two views are co-equal halves of the workflow.

Concrete tour changes (decisions in 0a):

- Likely an extra step (or expanded copy on the existing step) in
  `checklistSuggest` that explicitly says "these are your two main
  views — switch any time" and points at both tabs in turn on mobile,
  and at both panels on desktop.
- Possibly a step demonstrating the swap (the tour advances and the
  underlying view switches with it).
- Make sure the keyboard shortcut (`⌘K` / `⌘H`) is mentioned for
  desktop power users.

**Files most likely to change:**

- `src/ui/tour/tours.ts` — `checklistSuggest` tour copy / step list.
- i18n keys for any new step copy — `messages/en.json`.
- Manual tour-popover verification at both breakpoints per CLAUDE.md.

---

---

## 10. Red cells should show an X icon, not a dot

**Today.** Negative ("doesn't own this card") cells in the play-mode
checklist are visually carried by color (red) plus a small dot glyph.
Color-only encoding is an accessibility miss for colorblind users.

**Wanted.** Render the existing `XIcon` (per CLAUDE.md: "Icons" — `XIcon`
= non-destructive cancel/close) inside red cells so the meaning is
visible without seeing the color.

**Files most likely to change:**

- `src/ui/components/Checklist.tsx` — the cell-glyph rendering near
  line 1392 (comment: "hypothesised N shows a red badge"). Swap the
  dot for `<XIcon />`.
- `src/ui/components/Icons.tsx` — `XIcon` already exists; reuse, don't
  add a new variant.
- `src/ui/components/CellWhyPopover.tsx` — the mini glyph box at the
  top of the popover (Checklist.tsx line 2728 comment notes it's
  shared with the popover) should match.
- Verify both green ("owns") and red ("doesn't own") glyph treatments
  feel balanced after the change. If green also leans on color alone,
  consider `CheckIcon` for parity (related to #11).

---

## 11. Use CheckIcon / XIcon in prose, not "Y" / "N"

**Today.** ICU select keys in `messages/en.json` use `Y` / `other` to
discriminate "owns" vs "doesn't own" — see lines 81, 167, 175, 179, 183.
The cell popover toggle exposes these as `Y` / `N` / `?` to the user
(`HypothesisControl` in `CellWhyPopover.tsx`). Users never see "Y" or
"N" anywhere else, so it reads as developer jargon.

**Wanted.** Anywhere user-visible prose currently shows "Y" or "N",
substitute the corresponding `CheckIcon` / `XIcon` inline. The ICU
select key names can stay (`Y` is just a key name), but the rendered
output should be iconographic.

Specifically the cell-popover Hypothesis toggle should read as
`[✓] [✗] [?]` instead of `[Y] [N] [?]`.

**Files most likely to change:**

- `src/ui/components/CellWhyPopover.tsx` — the `HypothesisControl`
  toggle component (referenced lines 16–17 in earlier exploration).
  Replace the "Y" / "N" labels with the icon components.
- `messages/en.json` — audit every string that visibly displays "Y" or
  "N" to the user (vs uses them as ICU keys). Replace the user-facing
  characters with `CheckIcon` / `XIcon` rendered next to translated
  copy. Keep the ICU key names as-is.
- `src/ui/components/Icons.tsx` — `CheckIcon` should already exist;
  verify, add only if missing.
- Tests covering the toggle a11y labels — make sure the icons get
  accessible labels (`aria-label="owns"` / `aria-label="doesn't own"`)
  so screen readers don't see naked SVGs.

---

## 12. Persist partially-entered suggestion across tab switches

**Today.** `SuggestionForm.tsx` keeps the in-progress draft in local
React state (`useState<FormState>` at line 156, derived from
`formStateFromDraft` initially). When the user switches between
Checklist and Suggest tabs (or otherwise unmounts the form) the state
is lost — they have to re-enter pills they'd already picked.

This will get worse once **#9** lands, since making tab-swapping more
prominent (even via tour) only matters if drafts survive the swap.

**Wanted.** Keep the draft alive across tab switches.

**Storage decision:** see 0b. Recommendation is to lift into the
existing reducer + localStorage persistence layer, but confirm by
reading the persistence layer in `src/data/` first.

**Constraints (to pin in tests):**

- **Per-game scoping:** the draft clears when the user starts a new
  game — don't carry a half-typed Mrs. White suggestion into a game
  that doesn't include her.
- **Edit vs new draft:** `SuggestionForm.tsx` has two flows. Adding a
  brand-new suggestion (line 158, `formStateFromDraft` branch on no
  `suggestion` prop) needs persistence. Editing an existing suggestion
  (line 170, with `suggestion` prop) already has a saved
  source-of-truth — persistence must NOT apply to that flow.
- Draft clears on submit.

**Files most likely to change:**

- `src/ui/components/SuggestionForm.tsx` — replace the local
  `useState` for the new-draft flow with reads/writes to the chosen
  storage layer.
- `src/logic/` (wherever the reducer lives) — if going the reducer
  route, add a `pendingSuggestion` slice + actions (set field,
  clear-on-submit, clear-on-new-game).
- The localStorage persistence layer (likely `src/data/` — see 0b).
- Tests pinning: draft survives unmount/remount, draft clears on
  submit, draft clears on new-game, draft does NOT bleed into the
  edit flow.

---

## 13. "Hypotheses" copy → "Have a hunch? Snuck a peek?"

**Today.** The cell popover and surrounding UI use the word
"Hypothesis" / "Hypotheses" as a section header. Per `messages/en.json`
the relevant keys include `popover.groupLabel` and `popover.hypothesisLabel`
(both = "Hypothesis", line ~142, 144), the various
`selectedHelp*` strings ("Hypothesis: {value} — plausible so far.", etc.,
lines 148–151), and the conflict banner title at line 326.

**Wanted.** Reword the user-facing label(s) to something more inviting,
like "Have a hunch? Snuck a peek?". The exact rewrite, which strings
change, and which keep the existing "Hypothesis" wording is to be
settled in 0f (audit first, then rewrite).

The reducer / log labels that aren't shown to users (`setHypothesis`
in the undo log, line 81; the `Hypothesis` type in code) keep their
current names — this is purely a copy change.

**Files most likely to change:**

- `messages/en.json` — the keys identified in 0f.
- `src/ui/components/CellWhyPopover.tsx` — if any literal "Hypothesis"
  copy is hardcoded there rather than coming from i18n.
- Verify nothing else in the app uses the same i18n keys (those keys
  may surface in tooltips, toasts, or onboarding tour copy).

---

## Verification (when each item ships)

Each item should be verified per the CLAUDE.md checklists relevant to
what it touches:

- **Layout / scroll changes (#1, #2, #5, #9):** walk the "Vertical page
  scroll", "Horizontal page scroll", and breakpoint-specific lists in
  CLAUDE.md → "Layout, scroll, and animation behaviors".
- **Tour-anchored changes (#1, #3, #7, #9):** walk every tour at desktop
  (1280×800) and mobile (375×812) per CLAUDE.md → "Tour-popover
  verification".
- **Pre-commit suite for every change:** `pnpm typecheck && pnpm lint &&
  pnpm test && pnpm knip && pnpm i18n:check`.
- **Manual preview verification:** every observable change is exercised
  in the `next-dev` preview before reporting done.
- **Analytics review (per CLAUDE.md):** new events worth emitting?
  Funnels affected? Add typed emitters in `src/analytics/events.ts`.

## Suggested batching

Land **#0 (open questions) first** — without those decisions resolved,
several items downstream risk inconsistency. After that, items are
independent enough to ship one-at-a-time, but a few cluster:

- **Cluster A (self-identity foundation):** #1 → #5 → #3. #1
  introduces `selfPlayerId` and the wizard; #5 and #3 both consume
  it. The Checklist cleanup falls out of #1 as a separate commit.
- **Cluster B (toolbar polish):** #7 alone, small.
- **Cluster C (suggest-pane polish):** #4, #6, #8, #12 — all touch
  the suggest pane. #12 ships before #9 (see below).
- **Cluster D (tour + discoverability):** #9 — purely tour copy /
  steps. Best timed alongside #1's tour rework (per 0a) so the two
  onboarding flows stay in sync. Don't ship #9 until #12 has landed,
  otherwise the prominent swap-callout exposes the draft-loss bug.
- **Cluster E (play-mode summary):** #2 — ships after #1 so the
  summary has a settled data shape to render.
- **Cluster F (icons / a11y):** #10 and #11 — both about not relying
  on color or developer-shorthand letters. Ship together so the
  visual language stays consistent across the cell glyph, the
  popover toggle, and any prose using "Y" / "N".
- **Cluster G (copy):** #13 — small, ships anytime after the audit
  in 0f. Consider bundling with Cluster F since it's another
  visual-polish pass on the cell popover.
