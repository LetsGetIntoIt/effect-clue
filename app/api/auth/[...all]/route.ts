/**
 * better-auth catch-all API route. Forwards every request under
 * `/api/auth/...` (sign in, sign out, OAuth callback, anonymous
 * upgrade, etc.) to better-auth's handler.
 *
 * Defense-in-depth layer 2 sits at the top of every method: if the
 * inbound path matches an email/password endpoint and the build is
 * not a development build, return a 404 immediately. better-auth
 * has already disabled those endpoints via
 * `emailAndPassword.enabled = false` in production — this is a
 * belt-and-braces safety net.
 */
import { auth } from "../../../../src/server/auth";

const DEV_ONLY_PATHS = [
    "/api/auth/sign-in/email",
    "/api/auth/sign-up/email",
];

const isDev = process.env["NODE_ENV"] === "development";

const guardOrHandle = async (request: Request): Promise<Response> => {
    if (!isDev) {
        const url = new URL(request.url);
        if (DEV_ONLY_PATHS.some((p) => url.pathname.startsWith(p))) {
            return new Response(null, { status: 404 });
        }
    }
    return auth.handler(request);
};

export const GET = guardOrHandle;
export const POST = guardOrHandle;
