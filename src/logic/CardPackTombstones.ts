/**
 * Tombstones for card packs the user has deleted while signed in.
 *
 * When a delete fails to reach the server (offline, 5xx, etc.), the
 * pack is removed from `effect-clue.custom-presets.v1` immediately
 * for snappy UI but a tombstone records the intent so:
 *
 *   - The next continuous-reconcile pull can retry `deleteCardPack`
 *     for each tombstone, then `clearTombstones` on success.
 *   - `reconcileCardPacks` filters tombstoned ids out of the pulled
 *     server list, so a pack the user deleted offline doesn't
 *     resurrect on the next pull.
 *   - `LogoutWarningModal` can name the deleted packs in the
 *     "won't be saved" list so the user knows what's at stake.
 *
 * Stored under `effect-clue.deleted-packs.v1` — separate keyspace
 * from packs themselves so a forward-only schema decision here can
 * never break the v1 pack reader. The `id` field is whatever id the
 * pack carried at delete time (could be a `custom-…` localStorage
 * id OR a server cuid2); `deleteCardPack` accepts either via
 * `idOrClientGeneratedId` so retry doesn't need to discriminate.
 *
 * Per CLAUDE.md, dates flow as `DateTime.Utc` in memory; the on-disk
 * shape stores epoch millis as a plain number and converts only at
 * the storage edge.
 */
import { DateTime, Result, Schema } from "effect";

const PersistedTombstoneSchema = Schema.Struct({
    id: Schema.String,
    label: Schema.String,
    deletedAt: Schema.Number,
});

const PersistedTombstonesSchema = Schema.Struct({
    version: Schema.Literal(1),
    entries: Schema.Array(PersistedTombstoneSchema),
});

const decodeUnknown = Schema.decodeUnknownResult(PersistedTombstonesSchema);
const encode = Schema.encodeSync(PersistedTombstonesSchema);

const STORAGE_KEY = "effect-clue.deleted-packs.v1";

export interface CardPackTombstone {
    /**
     * Whatever id the pack carried at delete time. The server's
     * `deleteCardPack` action looks up by either `id` OR
     * `client_generated_id`, so a tombstone created from a
     * never-synced local pack and one from a previously-synced pack
     * both flush identically.
     */
    readonly id: string;
    readonly label: string;
    readonly deletedAt: DateTime.Utc;
}

const empty: ReadonlyArray<CardPackTombstone> = [];

export const loadTombstones = (): ReadonlyArray<CardPackTombstone> => {
    if (typeof window === "undefined") return empty;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return empty;
        const decoded = decodeUnknown(JSON.parse(raw));
        if (Result.isFailure(decoded)) return empty;
        return decoded.success.entries.map(entry => ({
            id: entry.id,
            label: entry.label,
            deletedAt: DateTime.makeUnsafe(entry.deletedAt),
        }));
    } catch {
        return empty;
    }
};

const writeAll = (tombstones: ReadonlyArray<CardPackTombstone>): void => {
    if (typeof window === "undefined") return;
    try {
        const encoded = encode({
            version: 1,
            entries: tombstones.map(t => ({
                id: t.id,
                label: t.label,
                deletedAt: DateTime.toEpochMillis(t.deletedAt),
            })),
        });
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(encoded));
    } catch {
        // Quota exceeded, private mode, etc. — non-fatal.
    }
};

/**
 * Add or replace a tombstone for the given id. Idempotent: a repeat
 * call with the same id refreshes `deletedAt` and `label` rather
 * than appending a duplicate.
 */
export const addTombstone = (entry: CardPackTombstone): void => {
    const current = loadTombstones();
    const next = current.filter(t => t.id !== entry.id);
    next.push(entry);
    writeAll(next);
};

/**
 * Drop tombstones whose ids appear in `ids`. Called after a
 * successful `deleteCardPack` retry, or eagerly from
 * `useSaveCardPack` when a fast delete-then-save resurrects a pack.
 */
export const clearTombstones = (ids: ReadonlyArray<string>): void => {
    if (ids.length === 0) return;
    const drop = new Set(ids);
    const current = loadTombstones();
    const next = current.filter(t => !drop.has(t.id));
    if (next.length === current.length) return;
    writeAll(next);
};

/**
 * Wholesale clear — used by `clearAccountTiedLocalState` on logout.
 */
export const clearAllTombstones = (): void => {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Private mode, quota — non-fatal.
    }
};
