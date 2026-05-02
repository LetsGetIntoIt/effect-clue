/**
 * Daily cron — purge expired shares from the database.
 *
 * Schedule is daily (`0 7 * * *` UTC) rather than hourly because
 * Vercel's Hobby plan caps cron frequency at "daily or less". The
 * SHARE_TTL is still 24 hours; the cron's job is just to clean up
 * after expiry, not to enforce it. `getShare` filters out expired
 * rows via `expires_at > NOW()`, so the worst-case latency between
 * "share expired" and "row removed" is up to 24 hours — acceptable
 * because expired rows are already invisible to the application.
 *
 * The `expires_at` column is set on every `createShare` call (M17)
 * to `NOW() + SHARE_TTL`, so this cron is purely a maintenance
 * step: keep the table small, free disk on the Postgres free-tier,
 * and keep the indexes performant.
 *
 * Auth: requires `Authorization: Bearer ${CRON_SECRET}`. Vercel
 * cron automatically attaches this header when invoking the
 * configured schedule (see `vercel.ts`); manual / external callers
 * are rejected with `401`. Without `CRON_SECRET` configured the
 * route returns `503` so we don't silently allow unauthenticated
 * cleanup in misconfigured environments.
 *
 * The route runs through `withServerAction` like every other
 * server action, so the same Pg pool, telemetry runtime, and
 * migrator are reused — no extra setup per cron tick.
 */
import { Effect } from "effect";
import { PgClient } from "@effect/sql-pg";
import { NextResponse, type NextRequest } from "next/server";
import { withServerAction } from "../../../../src/server/withServerAction";

// Module-scope discriminator strings — exempt from
// `i18next/no-literal-string` (route-internal, not user copy).
const AUTH_HEADER = "authorization";
const BEARER_PREFIX = "Bearer ";
const ERR_NO_CRON_SECRET = "cron_secret_not_configured";
const ERR_UNAUTHORIZED = "unauthorized";

interface CleanupResult {
    readonly deletedCount: number;
}

const cleanupExpiredShares = (): Promise<CleanupResult> =>
    withServerAction(
        Effect.gen(function* () {
            const sql = yield* PgClient.PgClient;
            const rows = yield* sql<{ count: number }>`
                WITH deleted AS (
                    DELETE FROM shares
                    WHERE expires_at IS NOT NULL
                      AND expires_at < NOW()
                    RETURNING id
                )
                SELECT COUNT(*)::int AS count FROM deleted
            `;
            const deletedCount = rows[0]?.count ?? 0;
            return { deletedCount };
        }),
    );

export async function GET(request: NextRequest): Promise<NextResponse> {
    const expected = process.env["CRON_SECRET"];
    if (!expected) {
        return NextResponse.json(
            { error: ERR_NO_CRON_SECRET },
            { status: 503 },
        );
    }
    const header = request.headers.get(AUTH_HEADER) ?? "";
    if (!header.startsWith(BEARER_PREFIX)) {
        return NextResponse.json({ error: ERR_UNAUTHORIZED }, { status: 401 });
    }
    const token = header.slice(BEARER_PREFIX.length);
    if (token !== expected) {
        return NextResponse.json({ error: ERR_UNAUTHORIZED }, { status: 401 });
    }
    const result = await cleanupExpiredShares();
    return NextResponse.json(result);
}
