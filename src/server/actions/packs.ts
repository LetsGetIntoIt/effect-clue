/**
 * Server actions for the user's custom card packs (M8).
 *
 * Behaviour:
 *
 *   - `getMyCardPacks()` — auth-required. Returns every pack owned
 *     by the current user.
 *   - `saveCardPack({ clientGeneratedId, label, cardSetData })` —
 *     auth-required. Server mints `id`. UPSERT keyed by
 *     `(owner_id, client_generated_id)` so re-saving the same
 *     local pack is a no-op apart from updating the label /
 *     card-set / `updated_at`. `cardSetData` is the JSON-encoded
 *     `CardSet` produced by `serverPackCodec.encodeCardSet` —
 *     encoding is done client-side because passing a `Data.Class`
 *     instance through Next's RSC boundary loses the field.
 *   - `deleteCardPack({ idOrClientGeneratedId })` — auth-required,
 *     owner-scoped. Looks up by `id` first, then
 *     `client_generated_id`.
 *   - `pushLocalPacksOnSignIn({ packs })` — bulk UPSERT. Called
 *     from the better-auth `onSignIn` hook; transports every
 *     localStorage pack the just-signed-in user has. Idempotent
 *     — repeated sign-ins are no-ops. On `label` collision against
 *     an existing row with a different `client_generated_id`,
 *     appends ` (2)`, ` (3)`, etc. so the visible name is always
 *     unique within the user's library.
 *
 * Auth: every action calls `auth.api.getSession({ headers })`
 * before touching the DB. Anonymous sessions are treated as
 * not-signed-in for these endpoints (see the plan: anon users
 * keep their custom packs in localStorage; the server-side path
 * only kicks in once the user has linked a real identity).
 *
 * IDs: server-minted via `cuid2` (`@paralleldrive/cuid2`). The
 * client's localStorage-minted id rides along as
 * `client_generated_id` so the React Query cache stays stable
 * across the localStorage→server transition.
 */
"use server";

import { createId } from "@paralleldrive/cuid2";
import { Effect } from "effect";
import { PgClient } from "@effect/sql-pg";
import { headers } from "next/headers";
import { auth } from "../auth";
import { withServerAction } from "../withServerAction";

export interface PersistedCardPack {
    readonly id: string;
    readonly clientGeneratedId: string;
    readonly label: string;
    /** Stringified Effect-Schema-encoded CardSet. */
    readonly cardSetData: string;
}

interface SaveCardPackInput {
    readonly clientGeneratedId: string;
    readonly label: string;
    /**
     * Pre-encoded JSON string of the `CardSet`. Encoded client-side
     * (see `src/data/serverPackCodec.ts#encodeCardSet`) — `CardSet`
     * is an Effect `Data.Class` instance which doesn't survive
     * Next.js RSC argument serialisation; passing the encoded string
     * sidesteps that.
     */
    readonly cardSetData: string;
}

interface DeleteCardPackInput {
    readonly idOrClientGeneratedId: string;
}

interface PushLocalPacksInput {
    readonly packs: ReadonlyArray<{
        readonly clientGeneratedId: string;
        readonly label: string;
        readonly cardSetData: string;
    }>;
}

export interface PushResult {
    readonly countPushed: number;
    readonly countAlreadySynced: number;
    readonly countRenamed: number;
    readonly countDeduped: number;
    readonly countFailed: number;
}

// Module-scope error-discriminator strings, exempt from the
// i18next/no-literal-string rule.
const ERR_NOT_SIGNED_IN = "not_signed_in";
const ERR_UPSERT_NO_ROWS = "upsert_returned_no_rows";
const ERR_MALFORMED_INPUT = "malformed_input";
const PUSH_OUTCOME_ALREADY_SYNCED = "already_synced" as const;
const PUSH_OUTCOME_DEDUPED = "deduped" as const;
const PUSH_OUTCOME_RENAMED = "renamed" as const;
const PUSH_OUTCOME_PUSHED = "pushed" as const;

const visibleCardSetSignatureFromData = (raw: string): string | null => {
    try {
        const parsed: unknown = JSON.parse(raw);
        if (
            typeof parsed !== "object" ||
            parsed === null ||
            !("categories" in parsed) ||
            !Array.isArray(parsed.categories)
        ) {
            return null;
        }
        const categories = [];
        for (const category of parsed.categories) {
            if (
                typeof category !== "object" ||
                category === null ||
                !("name" in category) ||
                typeof category.name !== "string" ||
                !("cards" in category) ||
                !Array.isArray(category.cards)
            ) {
                return null;
            }
            const cards = [];
            for (const card of category.cards) {
                if (
                    typeof card !== "object" ||
                    card === null ||
                    !("name" in card) ||
                    typeof card.name !== "string"
                ) {
                    return null;
                }
                cards.push(card.name);
            }
            categories.push({ name: category.name, cards });
        }
        return JSON.stringify(categories);
    } catch {
        return null;
    }
};

const requireSignedInUser = async (): Promise<{
    readonly userId: string;
}> => {
    const session = await auth.api.getSession({
        headers: await headers(),
    });
    if (
        session === null ||
        session === undefined ||
        session.user.isAnonymous
    ) {
        throw new Error(ERR_NOT_SIGNED_IN);
    }
    return { userId: session.user.id };
};

/**
 * Returns the signed-in user's persisted packs. The shape is the
 * raw "wire format" — `cardSetData` is a JSON-encoded `CardSet`
 * string that the client deserialises with the same schema before
 * handing it to the rest of the app.
 */
export async function getMyCardPacks(): Promise<
    ReadonlyArray<PersistedCardPack>
> {
    const { userId } = await requireSignedInUser();
    return withServerAction(
        Effect.gen(function* () {
            const sql = yield* PgClient.PgClient;
            const rows = yield* sql<{
                id: string;
                client_generated_id: string;
                label: string;
                card_set_data: string;
            }>`
                SELECT id, client_generated_id, label, card_set_data
                FROM card_packs
                WHERE owner_id = ${userId}
                ORDER BY updated_at DESC
            `;
            return rows.map((row) => ({
                id: row.id,
                clientGeneratedId: row.client_generated_id,
                label: row.label,
                cardSetData: row.card_set_data,
            }));
        }),
    );
}

/**
 * UPSERT a single pack. The server-minted `id` is generated by
 * `cuid2` if no row exists for `(owner_id, client_generated_id)`;
 * otherwise the existing `id` is preserved and the label /
 * `card_set_data` / `updated_at` are refreshed.
 */
export async function saveCardPack(
    input: SaveCardPackInput,
): Promise<PersistedCardPack> {
    const { userId } = await requireSignedInUser();
    // Defensive parse — a stale client could post a missing or
    // malformed cardSetData. Rejecting here is better than silently
    // writing garbage that would fail a NOT NULL constraint or
    // poison reads later.
    if (visibleCardSetSignatureFromData(input.cardSetData) === null) {
        throw new Error(ERR_MALFORMED_INPUT);
    }
    const newId = createId();
    return withServerAction(
        Effect.gen(function* () {
            const sql = yield* PgClient.PgClient;
            const rows = yield* sql<{
                id: string;
                client_generated_id: string;
                label: string;
                card_set_data: string;
            }>`
                INSERT INTO card_packs (
                    id, client_generated_id, owner_id, label, card_set_data
                ) VALUES (
                    ${newId}, ${input.clientGeneratedId}, ${userId},
                    ${input.label}, ${input.cardSetData}
                )
                ON CONFLICT (owner_id, client_generated_id)
                DO UPDATE SET
                    label = EXCLUDED.label,
                    card_set_data = EXCLUDED.card_set_data,
                    updated_at = NOW()
                RETURNING id, client_generated_id, label, card_set_data
            `;
            const row = rows[0];
            if (!row) {
                throw new Error(ERR_UPSERT_NO_ROWS);
            }
            return {
                id: row.id,
                clientGeneratedId: row.client_generated_id,
                label: row.label,
                cardSetData: row.card_set_data,
            };
        }),
    );
}

/**
 * Delete a pack by either its server-minted `id` OR its
 * `client_generated_id`. Owner-scoped — never deletes another
 * user's row.
 */
export async function deleteCardPack(
    input: DeleteCardPackInput,
): Promise<void> {
    const { userId } = await requireSignedInUser();
    return withServerAction(
        Effect.gen(function* () {
            const sql = yield* PgClient.PgClient;
            yield* sql`
                DELETE FROM card_packs
                WHERE owner_id = ${userId}
                  AND (id = ${input.idOrClientGeneratedId}
                       OR client_generated_id = ${input.idOrClientGeneratedId})
            `;
        }),
    );
}

/**
 * Bulk push localStorage packs to the server on sign-in.
 *
 * Idempotent: re-running with the same `(clientGeneratedId,
 * label, cardSetData)` payloads is a no-op. The conflict policy
 * keys on `(owner_id, client_generated_id)` so a re-sign-in from
 * a second device merges cleanly.
 *
 * Label-collision policy: if a pack with a *different*
 * `client_generated_id` already owns the requested label, the
 * incoming pack lands with ` (2)` / ` (3)` etc. appended. The
 * counter is computed against the user's existing labels, so
 * the result is always unique within the library.
 */
export async function pushLocalPacksOnSignIn(
    input: PushLocalPacksInput,
): Promise<PushResult> {
    const { userId } = await requireSignedInUser();
    let countPushed = 0;
    let countAlreadySynced = 0;
    let countRenamed = 0;
    let countDeduped = 0;
    let countFailed = 0;
    for (const pack of input.packs) {
        const incomingSignature = visibleCardSetSignatureFromData(
            pack.cardSetData,
        );
        if (incomingSignature === null) {
            // Stale client posting a malformed pack. Skip rather than
            // throw past the loop so the rest of the batch lands.
            countFailed += 1;
            continue;
        }
        try {
            const outcome = await withServerAction(
                Effect.gen(function* () {
                    const sql = yield* PgClient.PgClient;

                    // Compute a non-colliding label first.
                    const existingLabels = yield* sql<{
                        label: string;
                        client_generated_id: string;
                        card_set_data: string;
                    }>`
                        SELECT label, client_generated_id, card_set_data
                        FROM card_packs
                        WHERE owner_id = ${userId}
                    `;

                    const sameClient = existingLabels.find(
                        (r) => r.client_generated_id === pack.clientGeneratedId,
                    );
                    if (sameClient) {
                        // Already synced — UPSERT will refresh fields.
                        const newId = createId();
                        yield* sql`
                            INSERT INTO card_packs (
                                id, client_generated_id, owner_id,
                                label, card_set_data
                            ) VALUES (
                                ${newId}, ${pack.clientGeneratedId},
                                ${userId}, ${pack.label}, ${pack.cardSetData}
                            )
                            ON CONFLICT (owner_id, client_generated_id)
                            DO UPDATE SET
                                card_set_data = EXCLUDED.card_set_data,
                                updated_at = NOW()
                        `;
                        return PUSH_OUTCOME_ALREADY_SYNCED;
                    }

                    const exactDuplicate = existingLabels.find((r) => {
                        if (r.label !== pack.label) return false;
                        return (
                            visibleCardSetSignatureFromData(r.card_set_data) ===
                            incomingSignature
                        );
                    });
                    if (exactDuplicate) {
                        return PUSH_OUTCOME_DEDUPED;
                    }

                    const labels = new Set(
                        existingLabels.map((r) => r.label),
                    );
                    let chosen = pack.label;
                    let renamed = false;
                    if (labels.has(pack.label)) {
                        let n = 2;
                        while (labels.has(`${pack.label} (${n})`)) n += 1;
                        chosen = `${pack.label} (${n})`;
                        renamed = true;
                    }

                    const newId = createId();
                    yield* sql`
                        INSERT INTO card_packs (
                            id, client_generated_id, owner_id,
                            label, card_set_data
                        ) VALUES (
                            ${newId}, ${pack.clientGeneratedId},
                            ${userId}, ${chosen}, ${pack.cardSetData}
                        )
                    `;
                    return renamed
                        ? PUSH_OUTCOME_RENAMED
                        : PUSH_OUTCOME_PUSHED;
                }),
            );
            if (outcome === PUSH_OUTCOME_RENAMED) {
                countRenamed += 1;
            } else if (outcome === PUSH_OUTCOME_ALREADY_SYNCED) {
                countAlreadySynced += 1;
            } else if (outcome === PUSH_OUTCOME_DEDUPED) {
                countDeduped += 1;
            } else {
                countPushed += 1;
            }
        } catch {
            countFailed += 1;
        }
    }
    return {
        countPushed,
        countAlreadySynced,
        countRenamed,
        countDeduped,
        countFailed,
    };
}
