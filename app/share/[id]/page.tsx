/**
 * Server-stored share landing page.
 *
 * Server-side: looks up the share by id. On hit, renders
 * `<ShareImportPage>`; on not-found / expired, renders
 * `<ShareMissingPage>`. Both branches sit inside the same
 * `ModalStackProvider` + `ConfirmProvider` + `ModalStackShell` so the
 * modal content (always rendered via `useModalStack().push`) has
 * access to confirm-style dialogs.
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
    let isMissing = false;
    try {
        snapshot = await getShare({ id });
    } catch (e) {
        if (String(e).includes(ERR_SHARE_NOT_FOUND)) {
            isMissing = true;
        } else {
            throw e;
        }
    }
    return (
        <ModalStackProvider>
            <ConfirmProvider>
                {isMissing || snapshot === undefined ? (
                    <ShareMissingPage shareId={id} />
                ) : (
                    <ShareImportPage snapshot={snapshot} />
                )}
                <ModalStackShell />
            </ConfirmProvider>
        </ModalStackProvider>
    );
}
