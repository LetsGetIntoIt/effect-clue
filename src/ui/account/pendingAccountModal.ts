/**
 * SessionStorage handle for the "re-open the Account modal after
 * OAuth" intent. Mirrors `pendingImport.ts` on the share-receive
 * side.
 *
 * The Account modal's anonymous render path kicks off Better Auth's
 * social sign-in via `authClient.signIn.social({ provider, callbackURL })`.
 * After Google redirects the user back, the SPA mounts fresh — the
 * modal is GONE because the stack didn't survive the navigation.
 * Without help, the user lands on the underlying page (Setup or
 * Checklist), signed in but with no visible feedback that the click
 * they made before redirect did anything.
 *
 * The fix is the same pattern share-import uses:
 *
 *   1. Before kicking off OAuth, `savePendingAccountModalIntent()`
 *      writes a timestamped marker.
 *   2. After OAuth lands the user back, `AccountProvider`'s mount
 *      effect waits for the session to settle (and for the user to
 *      be non-anonymous), then `consumePendingAccountModalIntent()`
 *      reads + clears the marker. If it was present and fresh, the
 *      provider calls `openModal()` automatically — the user lands
 *      back exactly where they were before sign-in.
 *
 * Malicious-URL safety: nothing on the page can write this
 * sessionStorage entry without the user's own click on the in-modal
 * "Sign in with Google" button. A drive-by URL gets no auto-open.
 * The freshness window keeps a leftover marker from an abandoned
 * earlier sign-in from re-firing days later.
 */
import { Duration } from "effect";

const PENDING_ACCOUNT_MODAL_KEY = "effect-clue.pending-account-modal.v1";

/**
 * OAuth round-trips are normally a few seconds; ten minutes covers
 * password-manager + 2FA + slow network without being so generous
 * that a stale marker from an earlier flow can resurface days later.
 */
const MAX_AGE = Duration.minutes(10);

interface PendingAccountModalIntent {
    /**
     * Epoch millis at the moment of save. Stored as a number so the
     * sessionStorage JSON round-trip is lossless. Compared via
     * `Date.now()` against `MAX_AGE` (in millis) at consume time.
     */
    readonly t: number;
}

const isPendingIntent = (raw: unknown): raw is PendingAccountModalIntent => {
    if (typeof raw !== "object" || raw === null) return false;
    const r = raw as Record<string, unknown>;
    return typeof r["t"] === "number";
};

export const savePendingAccountModalIntent = (): void => {
    try {
        const intent: PendingAccountModalIntent = { t: Date.now() };
        sessionStorage.setItem(
            PENDING_ACCOUNT_MODAL_KEY,
            JSON.stringify(intent),
        );
    } catch {
        // Non-fatal: OAuth still proceeds. Worst case the user lands
        // back signed in but has to click ⋯ → Account themselves —
        // graceful degradation, not a hard failure.
    }
};

/**
 * Read + remove the intent. Returns `true` only when an entry was
 * present AND was saved within `MAX_AGE` of now. Always clears the
 * entry from storage (even on mismatch / expiry / parse failure) so
 * stale intents never accumulate.
 */
export const consumePendingAccountModalIntent = (): boolean => {
    let parsed: unknown = null;
    try {
        const raw = sessionStorage.getItem(PENDING_ACCOUNT_MODAL_KEY);
        if (raw === null) return false;
        sessionStorage.removeItem(PENDING_ACCOUNT_MODAL_KEY);
        parsed = JSON.parse(raw);
    } catch {
        return false;
    }
    if (!isPendingIntent(parsed)) return false;
    const ageMillis = Date.now() - parsed.t;
    if (ageMillis < 0) return false;
    if (ageMillis > Duration.toMillis(MAX_AGE)) return false;
    return true;
};
