/**
 * RQ-wrapped session hook. Reads better-auth's session via the
 * `/api/auth/get-session` endpoint and caches it in the React Query
 * cache so the rest of the app can subscribe without re-fetching.
 *
 * Mirrors the convention from `src/data/`: one query per persistence
 * boundary, `staleTime` set to a generous default, mutations
 * (sign-in / sign-out) update the cache directly via
 * `setQueryData` rather than re-fetching.
 */
"use client";

import {
    useQuery,
    type UseQueryResult,
} from "@tanstack/react-query";
import { Duration } from "effect";

// Module-scope wire-format constants exempt from
// `i18next/no-literal-string`.
const SESSION_KEY = "session";
const GET_SESSION_URL = "/api/auth/get-session";
const CRED_INCLUDE: RequestCredentials = "include";

export const sessionQueryKey = [SESSION_KEY] as const;

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

const fetchSession = async (): Promise<Session | null> => {
    if (typeof window === "undefined") return null;
    try {
        const res = await fetch(GET_SESSION_URL, {
            credentials: CRED_INCLUDE,
        });
        if (!res.ok) return null;
        const json = (await res.json()) as
            | { user: SessionUser; session: { expiresAt: string } }
            | null;
        if (!json || !json.user) return null;
        return {
            user: json.user,
            expiresAt: json.session.expiresAt,
        };
    } catch {
        return null;
    }
};

/**
 * Returns the current session (or `null` for signed-out users).
 * Refetches on window focus so signing out in another tab is
 * picked up.
 */
export const useSession = (): UseQueryResult<Session | null, Error> =>
    useQuery({
        queryKey: sessionQueryKey,
        queryFn: fetchSession,
        staleTime: Duration.toMillis(Duration.minutes(5)),
        refetchOnWindowFocus: true,
    });
