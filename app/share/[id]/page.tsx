/**
 * Server-stored share landing page.
 *
 * Server-side: looks up the share by id. On not-found / expired,
 * renders `<ShareMissingPage>` (a standalone static modal — no
 * provider required). On hit, renders `<ShareImportPage>` inside
 * `ModalStackProvider` + `ConfirmProvider` so the import flow can
 * surface `useConfirm` warnings (dirty receiver game, save-as-new
 * pack name, etc.) via the modal stack.
 */
import {
    ModalStackProvider,
    ModalStackShell,
} from "../../../src/ui/components/ModalStack";
import { ConfirmProvider } from "../../../src/ui/hooks/useConfirm";
import { getShare } from "../../../src/server/actions/shares";
import { ERR_SHARE_NOT_FOUND } from "../../../src/server/shares/errors";
import { ShareImportPage } from "../../../src/ui/share/ShareImportPage";
import { ShareMissingPage } from "../../../src/ui/share/ShareMissingPage";

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
    } catch (e) {
        if (String(e).includes(ERR_SHARE_NOT_FOUND)) {
            return <ShareMissingPage shareId={id} />;
        }
        throw e;
    }
    return (
        <ModalStackProvider>
            <ConfirmProvider>
                <ShareImportPage snapshot={snapshot} />
                <ModalStackShell />
            </ConfirmProvider>
        </ModalStackProvider>
    );
}
