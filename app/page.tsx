import { redirect } from "next/navigation";
import { routes } from "../src/routes";

/**
 * Root path is just a redirect into `/play`. Server component so it
 * runs at build time under `output: "export"` — Next.js emits a
 * static `out/index.html` whose only content is a meta-refresh, so
 * the redirect happens before any of our app JS loads.
 */
export default function RootRedirect(): never {
    redirect(routes.play);
}
