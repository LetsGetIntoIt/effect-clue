/**
 * Per-pack "last used" timestamps.
 *
 * Recency drives which non-Classic packs surface as pills in the Use
 * card pack row — the top 3 most-recently-used packs ride alongside
 * Classic, with everything else hidden behind the "All card packs"
 * dropdown. Tracked by pack id so it works uniformly for built-in
 * packs (Classic, Master Detective) and user-saved custom packs.
 *
 * Lives in its own localStorage key, separate from
 * `effect-clue.custom-presets.v1`, so the existing custom-pack store
 * stays untouched and v1-decodable for users on older builds. Mirrors
 * the `CustomCardSets` / `SplashState` pattern: `Schema` validation
 * with silent fallback to empty on a malformed payload, try/catch
 * around writes for quota / private-mode safety.
 *
 * Per CLAUDE.md, durations and dates flow as Effect's `DateTime` in
 * memory; the on-disk shape stores epoch millis as a plain number and
 * we only convert at the storage edge.
 */
import { DateTime, Result, Schema } from "effect";

const PersistedEntrySchema = Schema.Struct({
    id: Schema.String,
    usedAt: Schema.Number,
});

const PersistedCardPackUsageSchema = Schema.Struct({
    version: Schema.Literal(1),
    entries: Schema.Array(PersistedEntrySchema),
});

const decodeUnknown = Schema.decodeUnknownResult(PersistedCardPackUsageSchema);
const encode = Schema.encodeSync(PersistedCardPackUsageSchema);

const STORAGE_KEY = "effect-clue.card-pack-usage.v1";

export type CardPackUsage = ReadonlyMap<string, DateTime.Utc>;

const empty: CardPackUsage = new Map();

/**
 * Read all per-pack recency entries from localStorage. Returns an
 * empty map if the key is missing or the payload doesn't decode.
 */
export const loadCardPackUsage = (): CardPackUsage => {
    if (typeof window === "undefined") return empty;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return empty;
        const decoded = decodeUnknown(JSON.parse(raw));
        if (Result.isFailure(decoded)) return empty;
        const out = new Map<string, DateTime.Utc>();
        for (const entry of decoded.success.entries) {
            out.set(entry.id, DateTime.makeUnsafe(entry.usedAt));
        }
        return out;
    } catch {
        return empty;
    }
};

const writeAll = (usage: CardPackUsage): void => {
    if (typeof window === "undefined") return;
    try {
        const encoded = encode({
            version: 1,
            entries: Array.from(usage.entries()).map(([id, usedAt]) => ({
                id,
                usedAt: DateTime.toEpochMillis(usedAt),
            })),
        });
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(encoded));
    } catch {
        // Quota exceeded, private mode, etc. — non-fatal.
    }
};

/**
 * Stamp `packId` as just-used. Subsequent reads will sort it ahead
 * of any pack with an older or missing entry.
 */
export const recordCardPackUse = (packId: string): void => {
    const current = new Map(loadCardPackUsage());
    current.set(packId, DateTime.nowUnsafe());
    writeAll(current);
};

/**
 * Drop the recency entry for `packId`. Called when a custom pack is
 * deleted so the store doesn't accrete orphan ids forever.
 */
export const forgetCardPackUse = (packId: string): void => {
    const current = loadCardPackUsage();
    if (!current.has(packId)) return;
    const next = new Map(current);
    next.delete(packId);
    writeAll(next);
};

/**
 * Rewrite usage entries from old pack ids to canonical pack ids after
 * de-duplication. If both ids have recency, keep the newer timestamp.
 */
export const remapCardPackUsageIds = (
    idMap: ReadonlyMap<string, string>,
): CardPackUsage => {
    if (idMap.size === 0) return loadCardPackUsage();
    const current = loadCardPackUsage();
    const next = new Map<string, DateTime.Utc>();
    for (const [id, usedAt] of current.entries()) {
        const target = idMap.get(id) ?? id;
        const existing = next.get(target);
        if (
            existing === undefined ||
            DateTime.toEpochMillis(usedAt) >
                DateTime.toEpochMillis(existing)
        ) {
            next.set(target, usedAt);
        }
    }
    writeAll(next);
    return next;
};

/**
 * Pack-shaped record consumed by `topRecentPacks`. Anything with an
 * `id` and a `label` qualifies — the helper is generic so callers can
 * pass the union of built-in `CardSetChoice` and user `CustomCardSet`
 * without a wrapper type. Kept module-internal — the constraint is
 * structural, callers don't need to import the type.
 */
interface PackLike {
    readonly id: string;
    readonly label: string;
}

/**
 * Case-insensitive label comparator for stable A→Z ordering. Exported
 * so callers (notably the dropdown order in CardPackRow) can sort
 * pack lists by the same rule the recency tie-breaker uses.
 */
export const compareCardPackLabels = (a: string, b: string): number =>
    a.localeCompare(b, undefined, { sensitivity: "base" });

/**
 * Return up to `limit` packs from `packs`, ordered most-recently-used
 * first. Packs without a recency record fall to the end and are
 * tie-broken alphabetically. Stable across re-reads of the same input.
 */
export const topRecentPacks = <P extends PackLike>(
    packs: ReadonlyArray<P>,
    usage: CardPackUsage,
    limit: number,
): ReadonlyArray<P> => {
    const ranked = [...packs].sort((a, b) => {
        const aAt = usage.get(a.id);
        const bAt = usage.get(b.id);
        if (aAt && bAt) {
            // Newer first.
            return DateTime.toEpochMillis(bAt) - DateTime.toEpochMillis(aAt);
        }
        if (aAt) return -1;
        if (bAt) return 1;
        return compareCardPackLabels(a.label, b.label);
    });
    return ranked.slice(0, Math.max(0, limit));
};
