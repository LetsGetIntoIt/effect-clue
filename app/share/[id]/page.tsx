import { notFound } from "next/navigation";

/**
 * Server-stored share route — placeholder.
 *
 * This route is reserved at the SSR-cutover milestone (M1) so the URL
 * shape `https://winclue.vercel.app/share/{cuid2}` is committed to
 * before any link-shaped feature lands. The actual share-fetch +
 * import-modal UI ships in M9 once the server runtime, auth, and
 * Postgres-backed `shares` table are in place.
 *
 * Until then, every `/share/...` request 404s. The historical base64
 * `?state=...` query-param share path on `/play` is being deleted
 * outright in M3 — there is no back-compat layer; old shared URLs
 * stop working when the new flow ships.
 */
export default function SharePagePlaceholder(): never {
    notFound();
}
