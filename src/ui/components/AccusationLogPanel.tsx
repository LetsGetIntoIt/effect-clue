"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ReactNode } from "react";
import { cardName } from "../../logic/GameSetup";
import { useClue } from "../state";
import { useConfirm } from "../hooks/useConfirm";
import { AccusationForm } from "./AccusationForm";

/**
 * "Failed accusations" panel mounted under the SuggestionLogPanel.
 * Two halves:
 *   - `<AddAccusation>`: the pill-driven form that dispatches
 *     `addAccusation` on submit.
 *   - `<PriorAccusations>`: the read-only list of every logged
 *     accusation, with edit and remove affordances.
 *
 * The whole thing is purposely small — failed accusations are rare
 * events compared to suggestions, so the UX targets clarity over
 * keyboard-power-user efficiency.
 */
export function AccusationLogPanel() {
    const t = useTranslations("accusations");
    return (
        <section className="mt-6 border-t border-border pt-4">
            <h2 className="m-0 mb-3 text-[14px] font-semibold uppercase tracking-[0.05em] text-accent">
                {t("title")}
            </h2>
            <AddAccusation />
            <PriorAccusations />
        </section>
    );
}

function AddAccusation() {
    const { dispatch, state } = useClue();
    return (
        <div className="mb-3">
            <AccusationForm
                setup={state.setup}
                onSubmit={draft => {
                    dispatch({ type: "addAccusation", accusation: draft });
                }}
            />
        </div>
    );
}

function PriorAccusations() {
    const t = useTranslations("accusations");
    const { state, dispatch } = useClue();
    const accusations = state.accusations;
    const [editingId, setEditingId] = useState<string | null>(null);
    const confirm = useConfirm();

    return (
        <div className="mt-3 border-t border-border pt-3">
            <h3 className="mt-0 mb-2 text-[13px] font-semibold">
                {t("priorTitle", { count: accusations.length })}
            </h3>
            {accusations.length === 0 ? (
                <p className="m-0 text-[13px] text-muted">
                    {t("priorEmpty")}
                </p>
            ) : (
                <ol className="m-0 list-decimal pl-6 text-[13px]">
                    {accusations.map((a, i) => {
                        const editing = editingId === String(a.id);
                        const cardLabels = a.cards
                            .map(c => cardName(state.setup, c))
                            .join(" + ");
                        return (
                            <li key={String(a.id)} className="py-1.5">
                                {editing ? (
                                    <AccusationForm
                                        setup={state.setup}
                                        accusation={a}
                                        showHeader={false}
                                        onSubmit={draft => {
                                            dispatch({
                                                type: "updateAccusation",
                                                accusation: draft,
                                            });
                                            setEditingId(null);
                                        }}
                                        onCancel={() => setEditingId(null)}
                                    />
                                ) : (
                                    <div className="flex items-baseline gap-2">
                                        <div className="min-w-0 flex-1">
                                            {t.rich("accusedLine", {
                                                accuser: String(a.accuser),
                                                cards: cardLabels,
                                                strong: (chunks: ReactNode) => (
                                                    <strong>{chunks}</strong>
                                                ),
                                            })}
                                        </div>
                                        <button
                                            type="button"
                                            className="cursor-pointer rounded border border-border bg-transparent px-2 py-0.5 text-[12px] text-muted hover:text-accent"
                                            onClick={() =>
                                                setEditingId(String(a.id))
                                            }
                                        >
                                            {t("editAction")}
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={t("removeAction")}
                                            className="cursor-pointer rounded border border-border bg-transparent px-2 py-0.5 text-[12px] text-muted hover:text-danger"
                                            onClick={() => {
                                                void (async () => {
                                                    const ok = await confirm({
                                                        message:
                                                            t("removeConfirm"),
                                                    });
                                                    if (ok)
                                                        dispatch({
                                                            type:
                                                                "removeAccusation",
                                                            id: a.id,
                                                        });
                                                })();
                                            }}
                                        >
                                            ×
                                        </button>
                                    </div>
                                )}
                                {/* Index for accessibility — i + 1 matches
                                    the displayed list ordering. */}
                                <span className="sr-only">{i + 1}</span>
                            </li>
                        );
                    })}
                </ol>
            )}
        </div>
    );
}
