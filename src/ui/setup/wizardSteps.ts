import { allCardIds, caseFileSize } from "../../logic/CardSet";
import type { ClueState } from "../../logic/ClueState";

/**
 * Identity for each step in the M6 setup wizard. Used as a stable
 * discriminator across the accordion shell, the focus context, and
 * the eventual analytics events. The string values double as DOM
 * `data-step-id` attributes on each panel.
 *
 * PR-A2 wires steps 2–4 (`players`, `identity`, `handSizes`). PR-A3
 * adds `cardPack`, `myCards`, and `knownCards`. The constants are
 * declared upfront so cross-step plumbing (focus context, validation
 * lookups) doesn't have to expand the union later.
 */
export type WizardStepId =
    | "cardPack"
    | "players"
    | "identity"
    | "handSizes"
    | "myCards"
    | "knownCards"
    | "teachMode"
    | "inviteOtherPlayers";

/**
 * Canonical ordering of the steps. The accordion renders panels in
 * this order; `visibleSteps` filters this array based on state. The
 * `inviteOtherPlayers` step is intentionally last — that's what makes
 * the wizard's `isLastStep` flip the sticky CTA to "Start playing"
 * on the invite panel, so the user lands on a one-click outbound
 * affordance right before they enter Play mode.
 */
const ALL_STEP_IDS: ReadonlyArray<WizardStepId> = [
    "cardPack",
    "players",
    "identity",
    "handSizes",
    "myCards",
    "knownCards",
    "teachMode",
    "inviteOtherPlayers",
];

/**
 * Filter the canonical step list to those that should render given
 * the current state. The only conditional today is `myCards`, which
 * is hidden entirely when `selfPlayerId === null` (per the plan's
 * 0i decision: gated steps are hidden, not shown with apologetic
 * empty-state copy). The accordion renders the remaining steps in
 * order; the user goes step 4 → step 6 directly when identity is
 * unset.
 *
 * `cardPack`, `myCards`, `knownCards` aren't shipped in PR-A2 — they
 * still appear here so this helper is stable across the rollout. The
 * shell renders only the steps it has implementations for, by
 * intersecting this output with the registered step components.
 */
export function visibleSteps(state: ClueState): ReadonlyArray<WizardStepId> {
    return ALL_STEP_IDS.filter(id => {
        if (id === "myCards") return state.selfPlayerId !== null;
        return true;
    });
}

/**
 * Step completion check. A step is "complete" when its data is
 * present in the state. The accordion uses this on mount to seed
 * which panels render as `complete` vs `editing` vs `pending`, and
 * after each user action to update the set.
 *
 * The semantics are deliberately permissive — "complete" means "the
 * user has touched this step and the data is non-empty," not "the
 * step's validation is passing." Validation is a separate concern;
 * a step with totals-don't-add-up still counts as complete (the
 * panel gets a warning banner, not a pending lock).
 *
 * Skippable steps (identity, hand sizes, my cards, known cards) are
 * marked complete the moment the user clicks Skip — that's wired in
 * the shell via an explicit `markComplete(stepId)` call. The reads
 * here are about post-mount inference, not the runtime advance flow.
 */
export function isStepDataComplete(
    stepId: WizardStepId,
    state: ClueState,
): boolean {
    switch (stepId) {
        case "cardPack":
            return state.setup.categories.length > 0;
        case "players":
            return state.setup.players.length >= 2;
        case "identity":
            return state.selfPlayerId !== null;
        case "handSizes":
            return state.handSizes.length > 0;
        case "myCards":
            if (state.selfPlayerId === null) return false;
            return state.knownCards.some(
                kc => kc.player === state.selfPlayerId,
            );
        case "knownCards":
            return state.knownCards.length > 0;
        case "teachMode":
            // Always considered complete — the toggle has a default
            // value (off), so the step is "done" the moment it loads.
            return true;
        case "inviteOtherPlayers":
            // Always considered complete — the step is purely an
            // optional outbound action with no stored data to gate on.
            return true;
    }
}

/**
 * Validation envelope for a step. The shell decides whether to
 * enable Next based on `level`, and renders the optional banner
 * inside the editing panel above the action row.
 *
 * `valid` — Next enabled, no banner.
 * `warning` — Next enabled, banner shown (e.g. hand-sizes don't
 * add up; we let the user proceed because today's checklist also
 * warns without blocking).
 * `blocked` — Next disabled, banner shown.
 */
export type StepValidationLevel = "valid" | "warning" | "blocked";

export interface StepValidation {
    readonly level: StepValidationLevel;
    readonly message: string | null;
}

// Discriminator constants — pulled to module scope so the
// i18next/no-literal-string lint treats them as identifiers, not
// user-facing copy. Callers compose them into StepValidation
// objects without inlining string literals.
const VALIDATION_VALID: StepValidationLevel = "valid";
export const VALIDATION_WARNING: StepValidationLevel = "warning";
export const VALIDATION_BLOCKED: StepValidationLevel = "blocked";

export const VALID: StepValidation = {
    level: VALIDATION_VALID,
    message: null,
};

/**
 * Whether the user can skip this step. Required steps (cardPack,
 * players) are not skippable in the UX sense — Skip there acts as
 * "accept defaults" only when the defaults already validate.
 *
 * The wizard's sticky CTA bar checks this PLUS
 * `stepValidationLevel(stepId, state)` to decide whether the Skip
 * button is enabled:
 *   - skippable + any level         → enabled
 *   - non-skippable + valid/warning → enabled (acts as "accept defaults")
 *   - non-skippable + blocked       → disabled
 */
export function stepIsSkippable(stepId: WizardStepId): boolean {
    switch (stepId) {
        case "cardPack":
        case "players":
            return false;
        case "identity":
        case "handSizes":
        case "myCards":
        case "knownCards":
        case "teachMode":
        case "inviteOtherPlayers":
            return true;
    }
}

/**
 * Validation level (no message) for the focused step. The wizard's
 * sticky CTA bar reads this to gate the Next button: blocked → Next
 * disabled. The per-step components still compute their own
 * `StepValidation` (with translated messages) for the inline banner;
 * this helper is the level-only view the bar needs without depending
 * on i18n.
 *
 * Steps that haven't been touched (e.g. cardPack with default
 * Classic loaded; players with the default 4-player roster) report
 * `valid` — that's what makes Skip act as "accept defaults" and
 * what makes Next on every step enabled by default.
 */
export function stepValidationLevel(
    stepId: WizardStepId,
    state: ClueState,
): StepValidationLevel {
    switch (stepId) {
        case "cardPack":
            return state.setup.categories.length < 1
                ? VALIDATION_BLOCKED
                : VALIDATION_VALID;
        case "players":
            return state.setup.players.length < 2
                ? VALIDATION_BLOCKED
                : VALIDATION_VALID;
        case "identity":
            return VALIDATION_VALID;
        case "handSizes": {
            const players = state.setup.players;
            if (players.length === 0) return VALIDATION_VALID;
            const handSizeMap = new Map(state.handSizes);
            const setSizes = players
                .map(p => handSizeMap.get(p))
                .filter((n): n is number => typeof n === "number");
            const allSet = setSizes.length === players.length;
            if (!allSet) return VALIDATION_VALID;
            const totalDealt =
                allCardIds(state.setup).length - caseFileSize(state.setup);
            const totalEntered = setSizes.reduce((a, b) => a + b, 0);
            return totalEntered === totalDealt
                ? VALIDATION_VALID
                : VALIDATION_WARNING;
        }
        case "myCards":
            return VALIDATION_VALID;
        case "knownCards":
            return VALIDATION_VALID;
        case "teachMode":
            return VALIDATION_VALID;
        case "inviteOtherPlayers":
            return VALIDATION_VALID;
    }
}

