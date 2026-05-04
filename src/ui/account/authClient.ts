"use client";

import { createAuthClient } from "better-auth/react";
import { anonymousClient } from "better-auth/client/plugins";

/**
 * Client-side Better Auth entry point.
 *
 * Keep this separate from `src/server/auth.ts`; that file imports
 * server-only modules and owns the Better Auth server instance. UI
 * code should use this client for sign-in, sign-out, and session
 * reads so Better Auth owns request shape, redirects, and cache
 * invalidation.
 */
export const authClient = createAuthClient({
    plugins: [anonymousClient()],
});
