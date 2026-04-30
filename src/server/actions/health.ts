/**
 * Sanity-check server action — proves the full stack composes
 * end-to-end (Effect → PgClient → Postgres → Effect).
 *
 * Exposed at `/api/health`. Returns `{ ok: true, now }` when the
 * runtime can talk to Postgres; throws on any failure (which
 * Sentry catches via `instrumentation.ts`'s `onRequestError`).
 *
 * Used during M6 verification and as a touch point for future
 * milestones — every M7+ feature can lean on the same wrapper.
 */
"use server";

import { Effect } from "effect";
import { PgClient } from "@effect/sql-pg";
import { withServerAction } from "../withServerAction";

interface HealthResponse {
    readonly ok: true;
    readonly now: string;
}

export const getHealth = async (): Promise<HealthResponse> =>
    withServerAction(
        Effect.gen(function* () {
            const sql = yield* PgClient.PgClient;
            const rows = yield* sql<{ now: string }>`
                SELECT NOW()::text AS now
            `;
            const fallback: HealthResponse = {
                ok: true as const,
                now: rows[0]?.now ?? "",
            };
            return fallback;
        }),
    );
