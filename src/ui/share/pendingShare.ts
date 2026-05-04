"use client";

import type { CreateShareInput } from "../../server/actions/shares";
import type { ShareVariant } from "./ShareCreateModal";

const PENDING_SHARE_KEY = "effect-clue.pending-share.v1";

export interface PendingShareIntent {
    readonly variant: ShareVariant;
    readonly payload: CreateShareInput;
    readonly packIsCustom: boolean;
    readonly includesProgress: boolean;
}

export const savePendingShareIntent = (intent: PendingShareIntent): void => {
    try {
        sessionStorage.setItem(PENDING_SHARE_KEY, JSON.stringify(intent));
    } catch {
        // Non-fatal: OAuth can still proceed, but the post-return
        // auto-resume won't have enough state to retry.
    }
};

export const consumePendingShareIntent = (): PendingShareIntent | null => {
    try {
        const raw = sessionStorage.getItem(PENDING_SHARE_KEY);
        if (raw === null) return null;
        sessionStorage.removeItem(PENDING_SHARE_KEY);
        const parsed = JSON.parse(raw) as PendingShareIntent;
        if (
            parsed.variant !== "pack" &&
            parsed.variant !== "invite" &&
            parsed.variant !== "transfer"
        ) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
};
