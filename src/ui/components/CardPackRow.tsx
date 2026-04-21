"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CARD_SETS } from "../../logic/GameSetup";
import {
    CustomCardSet,
    deleteCustomCardSet,
    loadCustomCardSets,
    saveCustomCardSet,
} from "../../logic/CustomCardSets";
import { useClue } from "../state";

/**
 * Card-pack picker row: swap the active deck without touching the
 * player roster. Only rendered while the UI is in Setup mode — in
 * Play mode the deck is locked and the buttons disappear. The custom
 * packs come from localStorage via loadCustomCardSets; save / delete
 * re-reads so the row reflects the latest state without a reload.
 */
export function CardPackRow() {
    const t = useTranslations("setup");
    const { state, dispatch, hasGameData } = useClue();
    const setup = state.setup;
    // Initialise empty so server HTML and client's first render agree; the
    // real list loads in a mount effect. Reading localStorage in the
    // useState initialiser would produce 0 packs on SSR and N packs on
    // the client's first render — a hydration mismatch.
    const [customPacks, setCustomPacks] = useState<ReadonlyArray<CustomCardSet>>(
        [],
    );
    useEffect(() => {
        setCustomPacks(loadCustomCardSets());
    }, []);

    const onCardSet = (choice: (typeof CARD_SETS)[number]) => {
        if (hasGameData() && !window.confirm(t("loadCardSetConfirm"))) return;
        dispatch({
            type: "loadCardSet",
            cardSet: choice.cardSet,
            label: choice.label,
        });
    };

    const onCustomPack = (pack: CustomCardSet) => {
        if (hasGameData() && !window.confirm(t("loadCardSetConfirm"))) return;
        dispatch({
            type: "loadCardSet",
            cardSet: pack.cardSet,
            label: pack.label,
        });
    };

    const onSaveCardSet = () => {
        const label = window.prompt(t("saveAsCardPackPrompt"));
        if (!label || !label.trim()) return;
        saveCustomCardSet(label.trim(), setup.cardSet);
        setCustomPacks(loadCustomCardSets());
    };

    const onDeleteCustomPack = (pack: CustomCardSet) => {
        if (
            !window.confirm(
                t("deleteCustomCardSetConfirm", { label: pack.label }),
            )
        )
            return;
        deleteCustomCardSet(pack.id);
        setCustomPacks(loadCustomCardSets());
    };

    return (
        <div className="mb-4 rounded-[var(--radius)] border border-border bg-case-file-bg p-3">
            <div className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-accent">
                {t("cardPack")}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {CARD_SETS.map(choice => (
                    <button
                        key={choice.id}
                        type="button"
                        className="cursor-pointer rounded border border-border bg-white px-3 py-1 text-[13px] hover:bg-hover"
                        onClick={() => onCardSet(choice)}
                    >
                        {choice.label}
                    </button>
                ))}
                {customPacks.map(pack => (
                    <span
                        key={pack.id}
                        className="inline-flex items-center overflow-hidden rounded border border-border bg-white text-[13px]"
                    >
                        <button
                            type="button"
                            className="cursor-pointer px-3 py-1 hover:bg-hover"
                            onClick={() => onCustomPack(pack)}
                            title={t("loadCustomCardSetTitle", { label: pack.label })}
                        >
                            {pack.label}
                        </button>
                        <button
                            type="button"
                            className="cursor-pointer border-l border-border px-2 py-1 text-muted hover:bg-hover hover:text-danger"
                            onClick={() => onDeleteCustomPack(pack)}
                            title={t("deleteCustomCardSetTitle", { label: pack.label })}
                            aria-label={t("deleteCustomCardSetAria", { label: pack.label })}
                        >
                            ×
                        </button>
                    </span>
                ))}
                <button
                    type="button"
                    className="cursor-pointer rounded border border-dashed border-border bg-white px-3 py-1 text-[13px] text-muted hover:bg-hover hover:text-accent"
                    onClick={onSaveCardSet}
                    title={t("saveAsCardPackTitle")}
                >
                    {t("saveAsCardPack")}
                </button>
            </div>
        </div>
    );
}
