/**
 * better-auth core tables.
 *
 * Transcribed from better-auth's CLI-generated SQL so the schema
 * goes through the same migrator pipeline as everything else.
 * Names match the better-auth defaults so the default Kysely
 * adapter just works:
 *
 *   - `user`         — one row per identity. `is_anonymous` is the
 *                      flag added by the anonymous plugin.
 *   - `session`      — active sessions, indexed by `user_id`.
 *   - `account`      — provider-specific credentials, including the
 *                      `password` column reused by the dev-only
 *                      email/password sign-in path.
 *   - `verification` — short-lived tokens for email verification +
 *                      password reset.
 *
 * Migration discipline (forward-only adds): see CLAUDE.md.
 */
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
        CREATE TABLE IF NOT EXISTS "user" (
            id              TEXT PRIMARY KEY,
            email           TEXT NOT NULL UNIQUE,
            email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
            name            TEXT,
            image           TEXT,
            is_anonymous    BOOLEAN NOT NULL DEFAULT FALSE,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `;

    yield* sql`
        CREATE TABLE IF NOT EXISTS "session" (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
            token       TEXT NOT NULL UNIQUE,
            expires_at  TIMESTAMPTZ NOT NULL,
            ip_address  TEXT,
            user_agent  TEXT,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `;
    yield* sql`
        CREATE INDEX IF NOT EXISTS session_user_id_idx ON "session"(user_id)
    `;

    yield* sql`
        CREATE TABLE IF NOT EXISTS "account" (
            id                          TEXT PRIMARY KEY,
            user_id                     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
            account_id                  TEXT NOT NULL,
            provider_id                 TEXT NOT NULL,
            access_token                TEXT,
            refresh_token               TEXT,
            id_token                    TEXT,
            access_token_expires_at     TIMESTAMPTZ,
            refresh_token_expires_at    TIMESTAMPTZ,
            scope                       TEXT,
            password                    TEXT,
            created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (provider_id, account_id)
        )
    `;
    yield* sql`
        CREATE INDEX IF NOT EXISTS account_user_id_idx ON "account"(user_id)
    `;

    yield* sql`
        CREATE TABLE IF NOT EXISTS "verification" (
            id          TEXT PRIMARY KEY,
            identifier  TEXT NOT NULL,
            value       TEXT NOT NULL,
            expires_at  TIMESTAMPTZ NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `;
});
