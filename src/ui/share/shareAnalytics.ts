/**
 * Hash a share id for analytics so PostHog never sees the raw cuid2.
 * Collisions are acceptable; we only need a stable per-link join key.
 */
export const hashShareId = (id: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i += 1) {
        h ^= id.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
};
