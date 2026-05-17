# The smartest Clue solver: brainstorm

## Highlighted threads

Two themes flagged as most interesting; the rest of the document is the
broader menu they sit inside.

- **Opponent modeling + self-refute log** (sections B and D1). Capturing
  which card YOU show when refuting is the gating prerequisite; once
  that's logged, run a deducer from each opponent's POV to model what
  they know, then derive a race-to-accuse estimator and an adversarial
  suggestion advisor. Biggest greenfield in the app.
- **Post-game replay + hindsight** (section F). Replay/time-machine
  over the existing event log, "you could have solved 3 turns earlier"
  hindsight report, accuracy stats, shareable summary, saved-games
  library. Turns the app into a practice partner.

When ready to commit to building either, pull the relevant subsection
below into its own design pass — these are still brainstorm-depth, not
implementation plans.

## Context

You want this app to be the smartest Clue helper ever made. Today it's
already strong: a constraint-propagation deducer with 8+ rules, an
information-gain recommender, behavioral-insight pattern detectors, a
hypothesis sandbox with joint deduction, and a teach-mode classifier. But
there are entire surface areas the app doesn't touch yet — and the engine
itself has room to get sharper. This document is a wide-aperture
brainstorm of where to go next, grouped by theme, so we can pick the
most exciting threads to actually build.

Where each idea lands today is in parentheses; "greenfield" means there's
no existing surface.

---

## A. Sharpen the deducer (make it find inferences it currently misses)

The current engine is monotone-rule based. It runs to a fixed point, but
each rule looks at a small slice of state. There are deduction patterns
human Clue veterans use that we're either not doing or only partially
doing.

1. **Per-suggestion "refuter-card-set" tracking.** When Player B refutes
   a suggestion of {Scarlet, Knife, Library}, today we record "B has at
   least one of those three" implicitly through `RefuterOwnsOneOf`. Make
   that an explicit first-class object — a *refutation constraint*. Then
   add rules that intersect them: if B refuted two suggestions whose
   card-sets share only `{Knife}`, B has the knife.
   (Today partially handled by `DisjointGroupsHandLock`; the
   intersection rule generalises it.) *(extends `src/logic/Rules.ts`)*

2. **Subset / superset hand-size pigeonhole.** If three players each have
   exactly one of `{Knife, Rope}` (refutation constraints), and between
   them they hold ≥2 of those cards, the third card of that pair must be
   in the case file or the remaining player. Generalised: any time a
   group of K players collectively must hold ≥M cards drawn from a set
   of size N, push it through to other rows. *(extends `Rules.ts`)*

3. **SAT-style backtracking fallback.** When the monotone rules reach a
   fixed point with unknowns left, kick off a bounded search:
   "assume Knife is in case file → run deducer → did it produce a new Y
   or N? If so, that's not yet provable, but it's evidence; if it
   reached a contradiction, we just proved Knife is NOT in the case
   file." This is exactly the Recommender's "trial-deduce" pattern but
   used inferentially, not just for ranking. *(new
   `src/logic/Backtracker.ts` next to `Deducer.ts`)*

4. **Probabilistic belief layer alongside Y/N.** Today each cell is one
   of {Y, N, ?}. Add a parallel `belief: number ∈ [0,1]` per unknown
   cell, computed by sampling consistent worlds via the Recommender's
   probability model. Surfaces as a heatmap in the grid (see G3).
   *(new `src/logic/Beliefs.ts`)*

5. **Reasoning about the suggester.** "A player rarely suggests cards
   they hold" is a heuristic, not a hard rule — but it's a strong signal.
   Add a soft-inference layer (probabilistic, not committed) that
   nudges beliefs based on suggester behavior. *(extends
   `src/logic/BehavioralInsights.ts`)*

6. **Cross-game card-pack learning.** If a player consistently bluffs
   (suggests own cards), learn that per-player and tone down the
   suggester heuristic for them. *(new persistence: per-player profile)*

---

## B. Opponent modeling & theory-of-mind (the biggest greenfield gap)

Today we model the *table* (who has what). We don't model what *each
opponent knows* — which is half of expert Clue play.

1. **Per-opponent deducer.** Run the deducer once from each opponent's
   point of view (using only the info they could see — public
   suggestions, what they themselves were shown). Result: for each
   opponent, a `Knowledge` of "what they probably know". Surfaces as a
   side-pane "Player B thinks…" view. *(new `src/logic/OpponentModel.ts`)*

2. **"Who-showed-what" log.** When YOU refute a suggestion, you choose
   which card to reveal. Today the app doesn't ask, doesn't store it,
   doesn't use it. Add a `selfRefutations: { suggestionId, shownCard }[]`
   field and ask on every refutation. Then opponent models can fold in
   "Player A saw my knife on turn 4" → they know I have the knife → their
   future suggestions are evidence about cards they don't already know I
   have. *(state shape change in `src/logic/ClueState.ts`, codec change
   in `src/logic/PersistenceSchema.ts`, share-wire decision per the
   five-bucket recipe in `AGENTS.md`)*

3. **Refutation-choice prediction.** When opponent A refutes opponent
   B's suggestion, A had a choice of which card to show. Model the
   choice (typically "the card B already knows I have, to avoid leaking
   new info"). Inferences: if A showed the knife to B, A probably
   thinks B already knew about the knife → tells us something about
   what A thinks B knows. *(builds on B1, B2)*

4. **"Race-to-accuse" estimator.** For each opponent's opponent-model,
   estimate how close they are to solving. Banner: "Player C is one
   suggestion away — accuse NOW or block their case-file by
   re-suggesting one of their candidate cards." *(new
   `src/logic/RaceEstimator.ts`)*

5. **Adversarial suggestion advisor.** Today the recommender maximizes
   *your* info. Add an objective that *minimizes opponents'* info gain
   from your suggestion. The trade-off slider is "Maximize my info" ↔
   "Don't leak to others". *(extends `src/logic/Recommender.ts`)*

---

## C. Strategy & action advice (tell me what to do, not just what's true)

Today's `recommendAction` returns Suggest / Accuse / NearlySolved /
Nothing. Push that further.

1. **"What should I do right now?" coach widget.** A single always-on
   line at the top of the page that reads like a chess engine's
   evaluation bar: "Best move: Suggest Plum/Rope/Kitchen (expected info
   gain: 2.3 cells). Alt: Set hypothesis on Knife=B." Composable from
   existing pieces. *(new `src/ui/components/CoachBar.tsx` + a unified
   `nextMoveAdvisor`)*

2. **Accusation confidence meter.** Right now "NearlySolved" is a
   binary. Replace with a 0–100% live confidence number per category
   AND for the joint (suspect×weapon×room). Triggers "Accuse?" CTA
   when joint p > threshold. *(builds on A4, surfaces in
   `AccusationForm`)*

3. **Bluff recommender.** Suggest cards FROM YOUR HAND to mislead
   opponents (a real expert tactic). Score by adversarial info loss
   (B5). *(extends Recommender)*

4. **Block-the-winner advisor.** If race estimator (B4) says opponent
   is 1–2 turns away, override info-gain ranking with "suggest cards
   from THEIR candidate set, even if low info gain, to delay them".
   *(extends Recommender)*

5. **End-game endgame solver.** When ≥3 categories are pinned, switch
   from info-gain ranking to bounded best-move search over the
   remaining game tree. *(new `src/logic/EndgameSolver.ts`)*

6. **Move evaluation history.** After each turn, log
   `expectedValue(myMove) vs expectedValue(bestMove)` so post-game
   feedback (F1) can compute "accuracy %" like chess.com.

---

## D. Capture more game data (input that unlocks new inferences)

Several inferences are blocked because we never collected the data.

1. **Self-refutation logging.** Critical — gates all of B2/B3. Should
   be a one-tap question after logging an opponent's suggestion you
   refuted. *(`SuggestionForm` extension)*

2. **Turn order.** Today the player list is just a list. Make turn
   order explicit, and either auto-advance after each suggestion or
   show a "next up" indicator. Unlocks: "you skipped Player C's turn",
   "Player A goes again because they suggested out of order". *(state:
   `turnOrder: PlayerId[]`, `currentTurnIndex`)*

3. **Player elimination.** Mark players as "out of play" after a failed
   accusation. The deducer should still use their cards (which never
   change) but UI hides them from suggestion forms. *(state:
   `eliminatedPlayerIds`)*

4. **Out-of-order / retroactive logging.** "I forgot to log a
   suggestion two turns ago" — let users insert at any position in the
   log and re-derive. Already possible via edit; surface it.

5. **Game start helpers.** Photo of your dealt cards → OCR → My Cards
   populated. Or: voice "I have Scarlet, Knife, Library, and Plum" →
   parsed. *(new `src/ui/setup/PhotoDealtCards.tsx` w/ Claude Vision
   API; new `src/ui/setup/VoiceDealtCards.tsx` w/ Web Speech API)*

6. **Voice suggestion logging.** "Scarlet in the library with the rope,
   Plum refuted with the rope" → parsed into a suggestion entry.
   Removes most input friction during live play. *(new
   `src/ui/suggest/VoiceSuggestionInput.tsx`)*

7. **Photo of paper detective sheet.** OCR an existing tracking sheet
   to bootstrap a new game. *(stretch, Claude Vision API)*

---

## E. Live multi-device play (the social greenfield)

Today shares are one-shot snapshots. A real-time mode would change the
app's role entirely.

1. **Live-table mode.** Every player at the table opens the app on
   their phone. Suggestions are entered once (by whoever is logging)
   and synced to all devices, each filtered to that player's
   perspective (no one else sees your hand). Underlying tech: the
   existing share-server can carry append-only event streams instead
   of just snapshots. *(extends `src/server/actions/shares.ts`)*

2. **Spectator / coach mode.** A friend follows your game from another
   device and can leave hint annotations. (Privacy-preserving — they
   only see what you can see.) *(builds on E1)*

3. **Async multi-game.** Track games across days; resume from where
   you left off across devices (already partially solved by sync).

4. **Tournament / league tracking.** Wins, losses, accuracy %, average
   turns to solve, per-opponent stats. *(new `src/logic/Stats.ts`)*

---

## F. Post-game analysis (currently absent)

After the game ends, today the app just sits there. Huge missed
opportunity.

1. **"How did I do?" report.** Accuracy of hypotheses, turns to solve
   vs optimal, missed deductions, wasted suggestions. Generated from
   the move-evaluation log (C6). *(new `src/ui/postgame/Report.tsx`)*

2. **Replay / time machine.** Step through the game suggestion by
   suggestion; see how the deduction grid evolved. Already in the
   data; just needs UI. *(new `src/ui/replay/Replay.tsx`)*

3. **"You could have won 3 turns earlier — here's how."** Run the
   solver against each historical state; find the earliest turn at
   which the case file was provable. *(new `src/logic/Hindsight.ts`)*

4. **Notable moments.** Auto-detect: best suggestion, biggest miss,
   key deduction, longest streak of correct hypotheses. Like a sports
   highlight reel. *(builds on F3)*

5. **Shareable game summary.** Generate a PDF / image / link of "the
   story of this game" to share with the table. *(new
   `src/ui/postgame/Export.tsx`)*

6. **Saved games library.** Today only the current game is in state.
   Persist completed games to localStorage / server. Stats roll up
   across them. *(new `src/data/savedGames.ts`)*

---

## G. UI intelligence (surface the smarts you already have, better)

The engine is smart; some of it is buried.

1. **Probabilistic heatmap.** Color cells by belief (A4). Glance →
   "Player B almost certainly has the knife". Toggle on/off so
   purists can keep the strict Y/N view. *(extends `Checklist.tsx`)*

2. **"What changed" diff banner.** After each suggestion, briefly flash
   newly-deduced cells with a sparkle / pulse. Lets the user see the
   *cascade* their action triggered. *(new
   `src/ui/components/DeductionDiff.tsx`)*

3. **Annotations.** Per-cell and per-player free-text notes. "Plum
   always looks guilty." Persisted, never shared on invite (sender's
   scratchwork — bucket 5 in the AGENTS.md recipe). *(state field
   `annotations: HashMap<key, string>`)*

4. **Compact strategy panel.** Persistent sidebar (desktop) / chip
   (mobile) showing: next best move, accusation confidence,
   race-to-accuse threat. Composable from existing surfaces.

5. **Why-not popovers.** Today the cell-explanation row tells you why
   something IS proven. Add "why is this still unknown?" — list the
   suggestions/cells whose resolution would settle it. *(extends
   `CellExplanationRow.tsx` — overlaps with existing Leads)*

6. **"Players who could refute the next X" preview.** Hover a
   recommendation → see which players, in which probability, would
   refute. *(extends Recommender UI)*

---

## H. Education mode (skill building beyond teach-me)

1. **Daily puzzle.** A fixed Clue scenario, "solve in N turns". Like
   chess puzzles or Wordle. Shareable score. *(new
   `app/puzzle/[date]/page.tsx`)*

2. **Tutorial games.** Scripted scenarios that teach one deduction
   pattern at a time (pigeonhole, disjoint groups, etc.). Builds on
   teach-mode. *(new `src/ui/tutorial/`)*

3. **AI opponents.** Practice against a configurable AI ("beginner /
   normal / expert / cheating"). The deducer is already strong enough
   to power this. *(new `src/logic/AIPlayer.ts`)*

4. **In-flow micro-lessons.** Tooltip-style mini-explanations of
   advanced rules when they fire. "You just used the disjoint-groups
   hand-lock rule — here's why it works." Once per rule per user.
   *(new `src/ui/lessons/`)*

---

## I. Engine architecture moonshots

1. **Natural-language explanations.** Pipe deduction chains through
   Claude API to render them as conversational prose. "Player A passed
   on a knife/library/scarlet suggestion. Their hand has 4 cards, 3
   already known (X, Y, Z), so the knife — if they had it — would force
   them to refute. Hence: not theirs." Falls back to the structured
   chain on error. *(new `src/logic/NaturalLanguageExplainer.ts` using
   the `claude-api` skill conventions)*

2. **LLM-assisted custom card packs.** "Make me a 'Severance' Clue
   pack" → generate categories, names, art. Reduces friction for the
   custom-pack feature.

3. **LLM-assisted natural-language game state.** "I'm playing 4
   players, Scarlet got the first deal, I'm Plum and I have Knife and
   Library so far" → state populated. Bridges to D6.

---

## J. Variants & house rules

1. **House-rules engine.** Configurable: # refutation cards revealed,
   pass-the-hand-around, "extra suspect", optional accusation re-roll.
   *(extends `GameSetup.ts`)*

2. **Clue Junior, Mystery of the Abbey, Sleuth, etc.** Different deck
   shapes already partially supported via custom packs; codify
   official variants and their rule deltas.

3. **Board-Clue extension.** If anyone cares about board position
   (likely out of scope — most digital users are tracking a physical
   game), add room-occupancy tracking and use it as a constraint
   ("you can only suggest cards if you're in that room").

---

## K. Quality-of-life polish

1. **Smart undo.** "Undo last suggestion" rolls back deduction state
   too, with visual diff of what cells reverted. *(new
   `src/state/undoStack.ts`)*

2. **Keyboard shortcuts for everything.** Power-user mode: log a
   suggestion entirely from keyboard, hypothesize from keyboard, etc.

3. **Apple Watch / wearable companion.** Tiny screen, log "who
   refuted" with a tap. Bluetooth-pair to the phone instance.

4. **PWA install prompt with offline-first solver.** The deducer runs
   client-side — full offline support is achievable.

5. **Snapshot bookmarks.** Save named snapshots of mid-game state to
   compare hypotheses ("what if I'd suggested the knife instead?").

---

## How to pick what to build

If the goal is "smartest Clue player ever", the highest-impact threads
are:

- **B (opponent modeling)** — this is the single largest gap between
  the app and a chess-engine-equivalent for Clue. Adding D1
  (self-refutation logging) is the gating prerequisite.
- **C (strategy/action advice)** — surfaces the engine's intelligence
  as actionable guidance instead of static deductions.
- **A1–A4 (deeper deduction)** — incremental but high-leverage; each
  unlocks classes of inferences expert humans make.
- **F (post-game analysis)** — turns the app from a tool into a
  practice partner, and creates a feedback loop for users to get
  better.

Lower-priority but exciting:

- **D5/D6 (photo / voice input)** — friction-killer; doesn't add
  intelligence but makes the smart features more usable in live play.
- **H1 (daily puzzle)** — growth/retention play; uses existing engine.
- **I1 (LLM explanations)** — quality-of-life on existing surfaces.
- **E1 (live-table mode)** — massive product expansion; only worth it
  if multi-device live play is the strategic direction.

## Verification (for whichever direction we pick)

Each thread above eventually needs its own design pass — none of these
are one-PR features. The verification approach for each will depend on
the work, but every direction will involve:

- **Deduction work (A, B):** new unit tests in
  `src/logic/*.test.ts`, golden-case scenarios that fail today and
  pass after, and manual verification in `next-dev` that the new
  inferences surface in the cell-explanation chains.
- **Strategy/coach work (C):** new unit tests on the recommender's
  output ordering for specific game states, plus manual verification
  that the coach-bar copy reads naturally at both viewports.
- **Input work (D):** end-to-end manual walkthrough in `next-dev` with
  a real photo / a real voice clip (the auto-test harness can't cover
  Web Speech API or camera).
- **Multi-device (E):** local-only happy path can be tested with two
  browser tabs against the dev server; full verification requires
  staging deployment.

We should pick one or two threads to commit to before sinking effort
into design docs for the rest.
