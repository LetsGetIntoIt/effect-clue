/**
 * Server-side custom card packs (M8).
 *
 * Custom packs live in localStorage by default; signed-in users
 * push their packs up so they sync across devices. Server-mints
 * the canonical `id`; the user's localStorage-minted id rides along
 * as `client_generated_id` so the client cache stays stable across
 * the localStorage→server transition (lookups can still find a row
 * by either id).
 *
 * `card_set_data` is an Effect-Schema-encoded `CardSet` stored as
 * text. The `CardPack` Model in `src/server/models/CardPack.ts`
 * deserialises it via `Schema.fromJsonString(CardSet)` at read
 * time and serialises at write.
 *
 * Migration discipline: forward-only adds. New columns added to
 * this table later must be nullable-with-default — see CLAUDE.md.
 */
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`
        CREATE TABLE IF NOT EXISTS card_packs (
            id                      TEXT PRIMARY KEY,
            client_generated_id     TEXT NOT NULL,
            owner_id                TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
            label                   TEXT NOT NULL,
            card_set_data           TEXT NOT NULL,
            created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (owner_id, client_generated_id)
        )
    `;
    yield* sql`
        CREATE INDEX IF NOT EXISTS card_packs_owner_id_idx
        ON card_packs(owner_id)
    `;
});
