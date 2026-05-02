import { redirect } from "next/navigation";
import { routes } from "../src/routes";

/**
 * Root path is just a redirect into `/play`. Server component, so the
 * redirect runs before any of the app's JS loads — Next.js sends a
 * 307 from the server and the client lands on `/play` directly.
 */
export default function RootRedirect(): never {
    redirect(routes.play);
}
