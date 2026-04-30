/**
 * Wrapper for every server action / API route handler that needs
 * the database. Routes the supplied Effect through `ServerRuntime`
 * so the same Pg pool, migrator, and (later) auth / telemetry
 * services are available end-to-end.
 *
 * Usage:
 *
 *     // src/server/actions/something.ts
 *     "use server";
 *
 *     import { Effect } from "effect";
 *     import { PgClient } from "@effect/sql-pg";
 *     import { withServerAction } from "../withServerAction";
 *
 *     export const getThing = (): Promise<{ ok: true }> =>
 *         withServerAction(
 *             Effect.gen(function* () {
 *                 const sql = yield* PgClient.PgClient;
 *                 yield* sql`SELECT 1`;
 *                 return { ok: true as const };
 *             }),
 *         );
 *
 * The first call after a cold-start triggers the migrator (one
 * cheap SELECT against the migrator's metadata table on every
 * subsequent call). The migrator's advisory lock means concurrent
 * cold-starts can't race.
 *
 * Errors fall through to the outer `runPromise` boundary; Sentry's
 * Next.js `instrumentation.ts` `onRequestError` catches anything
 * that escapes.
 */
import type { Effect } from "effect";
import type { PgClient } from "@effect/sql-pg";
import { ServerRuntime } from "./runtime";

export const withServerAction = <A, E>(
    effect: Effect.Effect<A, E, PgClient.PgClient>,
): Promise<A> => ServerRuntime.runPromise(effect);
