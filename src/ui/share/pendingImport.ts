/**
 * SessionStorage handle for the "I'm signing in to import this share"
 * intent. Counterpart to `pendingShare.ts` on the sender side.
 *
 * The receive page on `/share/[id]` requires a signed-in account to
 * import. When an anonymous user clicks the in-modal sign-in CTA, we:
 *
 *   1. Save `{ shareId, t, …picks }` into sessionStorage.
 *   2. Kick off Better Auth's social sign-in with `callbackURL =
 *      /share/[id]`.
 *   3. After OAuth redirects back, the page remounts; an effect calls
 *      `consumePendingImportIntent(shareId)`. If the stored intent
 *      matches the page's shareId AND was saved within `MAX_AGE`, the
 *      effect auto-fires the import — the user doesn't have to click
 *      "Import" a second time. Any encoded picks (identity + known
 *      cards) ride along and are applied as `ApplyOverrides`.
 *
 * Anonymous-mount restore: when the modal mounts and the user is
 * still anonymous (e.g. they hit back from the OAuth provider), the
 * page peeks at the entry (`peekPendingImportIntent`) and restores
 * the picks into modal-local state without clearing the entry. That
 * way the user's earlier picks aren't lost just because they bailed
 * mid-redirect, but the entry is still consumed cleanly when they
 * eventually do sign in.
 *
 * Malicious-URL safety: a third party who sends a `/share/[id]` URL
 * has no way to populate this sessionStorage entry. The only path that
 * writes the intent is the user's own click on the in-modal "Sign in
 * to import" button on this exact page. A drive-by malicious URL
 * renders the modal with the sign-in CTA and waits for explicit user
 * action — no auto-import. The shareId match also defends against
 * cross-share leaks: if the user previously signed in for share A and
 * now lands on share B, B's own intent is absent and nothing fires.
 */
import { Duration } from "effect";

const PENDING_IMPORT_KEY = "effect-clue.pending-import.v1";

/**
 * The OAuth round-trip is normally a few seconds; ten minutes is
 * comfortable headroom (a slow network + a password manager + 2FA),
 * but tight enough that an old, leaked sessionStorage entry from a
 * previous sign-in flow can't be reused later.
 */
const MAX_AGE = Duration.minutes(10);

export interface PendingImportIntent {
    readonly shareId: string;
    /**
     * Epoch millis at the moment of save. Stored as a number so
     * sessionStorage round-trips cleanly through JSON. Compared via
     * `Date.now()` against `MAX_AGE` (in millis) at consume time.
     */
    readonly t: number;
    /**
     * Wire-format strings of the receiver's optional picks, encoded
     * via the existing `selfPlayerIdCodec` / `knownCardsCodec` from
     * `ShareCodec.ts`. Absent when the user didn't pick anything
     * before clicking "Sign in to import" — auto-import falls back
     * to the same path as the manual Join CTA with no overrides.
     */
    readonly selfPlayerIdData?: string;
    readonly knownCardsData?: string;
}

/**
 * Shape returned by `consumePendingImportIntent` /
 * `peekPendingImportIntent` after validation. Only the override
 * strings are surfaced — the shareId match and freshness check are
 * already part of the validation, so the caller doesn't need them
 * after the call returns.
 */
export interface PendingImportOverrides {
    readonly selfPlayerIdData?: string;
    readonly knownCardsData?: string;
}

const isPendingImportIntent = (raw: unknown): raw is PendingImportIntent => {
    if (typeof raw !== "object" || raw === null) return false;
    const r = raw as Record<string, unknown>;
    if (typeof r["shareId"] !== "string") return false;
    if (typeof r["t"] !== "number") return false;
    // Override fields are optional; reject only if present-and-wrong-type.
    if (
        r["selfPlayerIdData"] !== undefined &&
        typeof r["selfPlayerIdData"] !== "string"
    ) {
        return false;
    }
    if (
        r["knownCardsData"] !== undefined &&
        typeof r["knownCardsData"] !== "string"
    ) {
        return false;
    }
    return true;
};

export const savePendingImportIntent = (intent: PendingImportIntent): void => {
    try {
        sessionStorage.setItem(PENDING_IMPORT_KEY, JSON.stringify(intent));
    } catch {
        // Non-fatal: OAuth can still proceed. The user will land back
        // on the share page and just have to click Import a second
        // time — graceful degradation, not a hard failure.
    }
};

const readAndValidate = (
    expectedShareId: string,
): PendingImportIntent | null => {
    let parsed: unknown = null;
    try {
        const raw = sessionStorage.getItem(PENDING_IMPORT_KEY);
        if (raw === null) return null;
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!isPendingImportIntent(parsed)) return null;
    if (parsed.shareId !== expectedShareId) return null;
    const ageMillis = Date.now() - parsed.t;
    if (ageMillis < 0) return null;
    if (ageMillis > Duration.toMillis(MAX_AGE)) return null;
    return parsed;
};

const overridesFrom = (
    intent: PendingImportIntent,
): PendingImportOverrides => {
    const out: { selfPlayerIdData?: string; knownCardsData?: string } = {};
    if (intent.selfPlayerIdData !== undefined) {
        out.selfPlayerIdData = intent.selfPlayerIdData;
    }
    if (intent.knownCardsData !== undefined) {
        out.knownCardsData = intent.knownCardsData;
    }
    return out;
};

/**
 * Read & remove the intent. Returns `null` unless the saved entry
 * matches `expectedShareId` AND was saved within `MAX_AGE` of now.
 * On match, returns the (possibly empty) override strings the user
 * encoded into the intent before redirecting to sign in.
 *
 * Always clears the entry from storage on every read (even on
 * mismatch / expiry / no-match) so stale intents don't accumulate
 * or trigger surprise auto-imports later.
 */
export const consumePendingImportIntent = (
    expectedShareId: string,
): PendingImportOverrides | null => {
    // Read raw FIRST, then unconditionally remove, then validate. The
    // remove must run even when the parse fails so a corrupt entry
    // doesn't poison future visits.
    let raw: string | null = null;
    try {
        raw = sessionStorage.getItem(PENDING_IMPORT_KEY);
    } catch {
        return null;
    }
    try {
        sessionStorage.removeItem(PENDING_IMPORT_KEY);
    } catch {
        // ignore — best effort cleanup
    }
    if (raw === null) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!isPendingImportIntent(parsed)) return null;
    if (parsed.shareId !== expectedShareId) return null;
    const ageMillis = Date.now() - parsed.t;
    if (ageMillis < 0) return null;
    if (ageMillis > Duration.toMillis(MAX_AGE)) return null;
    return overridesFrom(parsed);
};

/**
 * Read WITHOUT removing. Used by the anonymous-mount restore effect
 * in `ShareImportPage` to repopulate the modal's local pick state
 * when the user navigates back to the modal after starting sign-in
 * but before completing OAuth. The intent stays in storage so a
 * subsequent successful OAuth round-trip can still auto-import.
 *
 * Returns `null` under the same conditions as
 * `consumePendingImportIntent` (no entry / wrong shareId / expired /
 * malformed).
 */
export const peekPendingImportIntent = (
    expectedShareId: string,
): PendingImportOverrides | null => {
    const intent = readAndValidate(expectedShareId);
    return intent === null ? null : overridesFrom(intent);
};
