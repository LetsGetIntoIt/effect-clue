/**
 * App-shaped wrapper around Better Auth's React session hook.
 *
 * The Better Auth client owns the actual `/api/auth/get-session`
 * request, cache, focus revalidation, and cross-tab updates. This
 * wrapper keeps the smaller shape existing UI components read
 * (`session.data?.user.isAnonymous`, `expiresAt`) so the rest of the
 * app doesn't depend on Better Auth's full wire object.
 */
"use client";

import { authClient } from "../account/authClient";

/**
 * Shape of the session better-auth returns. Subset of the full
 * better-auth `SessionData` — we read these fields in components.
 */
interface SessionUser {
    readonly id: string;
    readonly email: string;
    readonly name: string | null;
    readonly image: string | null;
    readonly isAnonymous: boolean;
}

interface Session {
    readonly user: SessionUser;
    readonly expiresAt: string;
}

interface SessionResult {
    readonly data: Session | null;
    readonly isPending: boolean;
    readonly isRefetching: boolean;
    readonly error: Error | null;
    readonly refetch: () => Promise<void>;
}

const toExpiresAt = (value: unknown): string => {
    if (value instanceof Date) return value.toISOString();
    return typeof value === "string" ? value : String(value);
};

/**
 * Returns the current session (or `null` for signed-out users).
 */
export const useSession = (): SessionResult => {
    const session = authClient.useSession();
    const raw = session.data;
    const data =
        raw == null
            ? null
            : {
                  user: {
                      id: raw.user.id,
                      email: raw.user.email,
                      name: raw.user.name,
                      image: raw.user.image ?? null,
                      isAnonymous: raw.user.isAnonymous === true,
                  },
                  expiresAt: toExpiresAt(raw.session.expiresAt),
              };
    return {
        data,
        isPending: session.isPending,
        isRefetching: session.isRefetching,
        error: session.error,
        refetch: session.refetch,
    };
};
