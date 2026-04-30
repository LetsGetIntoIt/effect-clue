/**
 * Server-stored share landing page.
 *
 * Server-side: looks up the share by id; on miss, returns 404
 * (`notFound()`). On hit, renders the client-side
 * `<ShareImportPage>` with the snapshot. The actual import logic
 * (decode → toggle UI → apply to local game state) lives on the
 * client because it needs access to the receiver's
 * `<ClueProvider>`.
 */
import { notFound } from "next/navigation";
import { getShare } from "../../../src/server/actions/shares";
import { ShareImportPage } from "../../../src/ui/share/ShareImportPage";

interface Params {
    readonly id: string;
}

export default async function SharePageRoute({
    params,
}: {
    readonly params: Promise<Params>;
}): Promise<React.ReactElement> {
    const { id } = await params;
    let snapshot;
    try {
        snapshot = await getShare({ id });
    } catch {
        notFound();
    }
    return <ShareImportPage snapshot={snapshot} />;
}
