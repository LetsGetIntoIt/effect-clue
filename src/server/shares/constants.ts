/**
 * Server-side constants and helpers for the M9 sharing flow.
 *
 * `SHARE_TTL` is the lifetime of a freshly-created share. The
 * `createShare` action stamps `expires_at = NOW() + SHARE_TTL` on
 * insert; `getShare` filters out expired rows; the hourly cron at
 * `app/api/crons/cleanup-shares` deletes them outright.
 *
 * The display string is sourced from `share.ttl` in `messages/en.json`
 * — keeping the i18n key in lockstep with this constant means
 * changing the TTL only requires updating both side-by-side. We
 * deliberately keep them as separate sources (the constant is the
 * server's source of truth, the i18n key is the user-facing copy)
 * rather than auto-deriving copy from the duration to avoid
 * locale-aware formatting headaches.
 */
import { Duration } from "effect";

/**
 * How long a share lives before `getShare` treats it as expired and
 * the cleanup cron purges it. User-confirmed at 1 day.
 */
export const SHARE_TTL: Duration.Duration = Duration.hours(24);
