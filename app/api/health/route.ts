/**
 * Public health-check API route. GET-only; returns `{ ok: true,
 * now }` when the server runtime can reach Postgres. Used by:
 *
 *   - M6 verification (curl from a Vercel preview deploy).
 *   - Uptime monitors (the response is JSON, so a simple `200 +
 *     `ok: true` check works).
 *
 * Errors propagate to Next.js's default error handler, which
 * `instrumentation.ts` forwards to Sentry via `onRequestError`.
 */
import { NextResponse } from "next/server";
import { getHealth } from "../../../src/server/actions/health";

export async function GET(): Promise<NextResponse> {
    const result = await getHealth();
    return NextResponse.json(result);
}
