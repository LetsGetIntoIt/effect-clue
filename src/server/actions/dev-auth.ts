/**
 * Bespoke dev-only sign-in action. Lets a development-machine UI
 * authenticate against pre-seeded test users without going through
 * Google OAuth.
 *
 * Defense-in-depth layer 3: the function itself dies (not returns
 * a typed failure) if it's ever reached on a non-development build.
 * `Effect.die` is intentional — anyone reaching this in production
 * has already bypassed two earlier guards (better-auth config, API
 * route) and the right behaviour is to crash so Sentry catches it.
 */
"use server";

import { Effect } from "effect";

const isDev = process.env["NODE_ENV"] === "development";

interface DevSignInInput {
    readonly username: string;
    readonly password: string;
}

interface DevSignInResult {
    readonly ok: boolean;
}

export const signInWithDevCredentials = async (
    _input: DevSignInInput,
): Promise<DevSignInResult> => {
    if (!isDev) {
        return Effect.runPromise(
            Effect.die(
                new Error(
                    "dev-only login is not available in production",
                ),
            ),
        );
    }
    // The actual credential validation flows through better-auth's
    // sign-in/email handler — this server action is just the
    // ergonomic wrapper a future M7 dev login form will call. The
    // form submits the email/password directly to
    // `/api/auth/sign-in/email`; this server action exists so the
    // build-time grep in `assert-no-dev-auth.mjs` has a single
    // identifier to look for.
    return { ok: true };
};
