/**
 * SessionStorage handle for the "I'm signing in to import this share"
 * intent. Counterpart to `pendingShare.ts` on the sender side.
 *
 * The receive page on `/share/[id]` requires a signed-in account to
 * import. When an anonymous user clicks the in-modal sign-in CTA, we:
 *
 *   1. Save `{ shareId, t }` into sessionStorage.
 *   2. Kick off Better Auth's social sign-in with `callbackURL =
 *      /share/[id]`.
 *   3. After OAuth redirects back, the page remounts; an effect calls
 *      `consumePendingImportIntent(shareId)`. If the stored intent
 *      matches the page's shareId AND was saved within `MAX_AGE`, the
 *      effect auto-fires the import — the user doesn't have to click
 *      "Import" a second time.
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

interface PendingImportIntent {
    readonly shareId: string;
    /**
     * Epoch millis at the moment of save. Stored as a number so
     * sessionStorage round-trips cleanly through JSON. Compared via
     * `Date.now()` against `MAX_AGE` (in millis) at consume time.
     */
    readonly t: number;
}

const isPendingImportIntent = (raw: unknown): raw is PendingImportIntent => {
    if (typeof raw !== "object" || raw === null) return false;
    const r = raw as Record<string, unknown>;
    return typeof r["shareId"] === "string" && typeof r["t"] === "number";
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

/**
 * Read & remove the intent. Returns `true` only when the saved entry
 * matches `expectedShareId` AND was saved within `MAX_AGE` of now.
 * Always clears the entry from storage (even on mismatch / expiry) so
 * stale intents don't accumulate or trigger surprise auto-imports
 * later.
 */
export const consumePendingImportIntent = (
    expectedShareId: string,
): boolean => {
    let parsed: unknown = null;
    try {
        const raw = sessionStorage.getItem(PENDING_IMPORT_KEY);
        if (raw === null) return false;
        sessionStorage.removeItem(PENDING_IMPORT_KEY);
        parsed = JSON.parse(raw);
    } catch {
        return false;
    }
    if (!isPendingImportIntent(parsed)) return false;
    if (parsed.shareId !== expectedShareId) return false;
    const ageMillis = Date.now() - parsed.t;
    if (ageMillis < 0) return false;
    if (ageMillis > Duration.toMillis(MAX_AGE)) return false;
    return true;
};
