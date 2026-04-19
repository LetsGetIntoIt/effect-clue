"use client";

import { Result } from "effect";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Card, Player } from "../../logic/GameObjects";
import { cardName, categoryOfCard } from "../../logic/GameSetup";
import {
    consolidateRecommendations,
    describeRecommendation,
    recommendSuggestions,
} from "../../logic/Recommender";
import { useHover } from "../HoverContext";
import { Tooltip } from "./Tooltip";
import { newSuggestionId } from "../../logic/Suggestion";
import {
    DraftSuggestion,
    useClue,
} from "../state";

const SECTION_TITLE = "mt-0 mb-2 text-[14px] font-semibold";
const SELECT_CLASS =
    "flex-1 rounded border border-border p-1.5 text-[13px]";
const LABEL_ROW = "flex items-center gap-1.5 text-[13px]";
const FORM_BTN_ACCENT =
    "cursor-pointer rounded border-none bg-accent p-2 text-white disabled:cursor-not-allowed disabled:bg-unknown";
const FORM_BTN_GHOST =
    "cursor-pointer rounded border border-border bg-white px-3.5 py-1 text-[13px]";

/**
 * Consolidated card for everything the solver's primary loop touches:
 * adding a suggestion, getting recommendations for the next one, and
 * reviewing / editing the log of prior suggestions.
 */
export function SuggestionLogPanel() {
    const t = useTranslations("suggestions");
    return (
        <section className="min-w-0 rounded-[var(--radius)] border border-border bg-panel p-4">
            <h2 className="m-0 mb-3 text-[16px] uppercase tracking-[0.05em] text-accent">
                {t("title")}
            </h2>
            <div className="grid gap-5 [@media(min-width:800px)]:grid-cols-[minmax(280px,1fr)_minmax(280px,1fr)]">
                <AddSuggestion />
                <Recommendations />
            </div>
            <PriorSuggestions />
        </section>
    );
}

/**
 * Map a suggestion's `cards` array back to one card per category, keyed
 * by the category's name. Cards whose category isn't in the current
 * setup are dropped — the form falls back to blank for that slot.
 */
/**
 * Map a suggestion's `cards` array (ids) back to one card id per category,
 * keyed by the category id (as a string). Cards whose category isn't in
 * the current setup are dropped — the form falls back to blank for that
 * slot. Cards are indexed by id here, not name, so renames don't break
 * the form's pre-population.
 */
const pickCardsByCategory = (
    suggestion: DraftSuggestion,
    setup: ReturnType<typeof useClue>["state"]["setup"],
): Map<string, string> => {
    const out = new Map<string, string>();
    for (const cardId of suggestion.cards) {
        const catId = categoryOfCard(setup, cardId);
        if (catId) out.set(String(catId), String(cardId));
    }
    return out;
};

function AddSuggestion() {
    const t = useTranslations("suggestions");
    const { state, dispatch } = useClue();
    const setup = state.setup;
    const [cardByCategory, setCardByCategory] = useState<
        Map<string, string>
    >(new Map());
    const [suggester, setSuggester] = useState<string>(
        setup.players[0] ?? "",
    );
    const [refuter, setRefuter] = useState<string>("");
    const [seenCard, setSeenCard] = useState<string>("");
    const [passedPlayers, setPassedPlayers] = useState<Set<string>>(
        new Set(),
    );

    // Keep the suggester dropdown valid when players come and go.
    useEffect(() => {
        if (
            suggester &&
            setup.players.some(p => String(p) === suggester)
        )
            return;
        setSuggester(setup.players[0] ?? "");
    }, [setup.players, suggester]);

    const canSubmit =
        suggester !== "" &&
        setup.categories.length > 0 &&
        setup.categories.every(
            c => (cardByCategory.get(String(c.id)) ?? "") !== "",
        );

    const setCardForCategory = (categoryName: string, value: string) => {
        const next = new Map(cardByCategory);
        if (value === "") next.delete(categoryName);
        else next.set(categoryName, value);
        setCardByCategory(next);
    };

    const onSuggesterChange = (value: string) => {
        setSuggester(value);
        const next = new Set(passedPlayers);
        next.delete(value);
        setPassedPlayers(next);
    };

    const onRefuterChange = (value: string) => {
        setRefuter(value);
        setSeenCard("");
        const next = new Set(passedPlayers);
        next.delete(value);
        setPassedPlayers(next);
    };

    const togglePassed = (name: string, checked: boolean) => {
        const next = new Set(passedPlayers);
        if (checked) next.add(name);
        else next.delete(name);
        setPassedPlayers(next);
    };

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        const cards = setup.categories.map(c =>
            Card(cardByCategory.get(String(c.id)) ?? ""),
        );
        const nonRefuters = setup.players.filter(p =>
            passedPlayers.has(String(p)),
        );
        dispatch({
            type: "addSuggestion",
            suggestion: {
                id: newSuggestionId(),
                suggester: Player(suggester),
                cards,
                nonRefuters,
                refuter: refuter ? Player(refuter) : undefined,
                seenCard: seenCard ? Card(seenCard) : undefined,
            },
        });
        setCardByCategory(new Map());
        setRefuter("");
        setSeenCard("");
        setPassedPlayers(new Set());
    };

    const eligibleForPassed = setup.players.filter(
        p => String(p) !== suggester && String(p) !== refuter,
    );

    const pickedCards = setup.categories
        .map(c => cardByCategory.get(String(c.id)) ?? "")
        .filter(c => c !== "");

    return (
        <div>
            <h3 className={SECTION_TITLE}>{t("addTitle")}</h3>
            <form
                onSubmit={onSubmit}
                className="flex flex-col gap-2"
            >
                <div>
                    <label className={LABEL_ROW}>
                        {t("suggesterLabel")}
                        <select
                            value={suggester}
                            onChange={e =>
                                onSuggesterChange(e.currentTarget.value)
                            }
                            className={SELECT_CLASS}
                            required
                        >
                            {setup.players.map(p => (
                                <option key={p} value={p}>
                                    {p}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
                {setup.categories.map(category => {
                    const catKey = String(category.id);
                    const value = cardByCategory.get(catKey) ?? "";
                    return (
                        <div key={catKey}>
                            <label className={LABEL_ROW}>
                                {t("categoryLabel", { category: category.name })}
                                <select
                                    value={value}
                                    onChange={e =>
                                        setCardForCategory(
                                            catKey,
                                            e.currentTarget.value,
                                        )
                                    }
                                    className={SELECT_CLASS}
                                    required
                                >
                                    <option value="">
                                        {t("placeholderOption")}
                                    </option>
                                    {category.cards.map(entry => (
                                        <option
                                            key={String(entry.id)}
                                            value={String(entry.id)}
                                        >
                                            {entry.name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    );
                })}
                <div>
                    <label className={LABEL_ROW}>
                        {t("refutedByLabel")}
                        <select
                            value={refuter}
                            onChange={e =>
                                onRefuterChange(e.currentTarget.value)
                            }
                            className={SELECT_CLASS}
                        >
                            <option value="">{t("noneOption")}</option>
                            {setup.players
                                .filter(p => String(p) !== suggester)
                                .map(p => (
                                    <option key={p} value={p}>
                                        {p}
                                    </option>
                                ))}
                        </select>
                    </label>
                </div>
                {refuter && (
                    <div>
                        <label className={LABEL_ROW}>
                            {t("cardShownLabel")}
                            <select
                                value={seenCard}
                                onChange={e =>
                                    setSeenCard(e.currentTarget.value)
                                }
                                className={SELECT_CLASS}
                            >
                                <option value="">
                                    {t("unknownOption")}
                                </option>
                                {pickedCards.map(cardId => (
                                    <option key={cardId} value={cardId}>
                                        {cardName(setup, Card(cardId))}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                )}
                {eligibleForPassed.length > 0 && (
                    <fieldset className="my-1 rounded-[var(--radius)] border border-border px-3 py-2">
                        <legend className="px-1 text-[13px] font-semibold">
                            {t("couldNotRefute")}
                        </legend>
                        {eligibleForPassed.map(p => (
                            <label
                                key={p}
                                className="flex cursor-pointer items-center gap-1.5 py-0.5 text-[13px]"
                            >
                                <input
                                    type="checkbox"
                                    className="m-0"
                                    checked={passedPlayers.has(String(p))}
                                    onChange={e =>
                                        togglePassed(
                                            String(p),
                                            e.currentTarget.checked,
                                        )
                                    }
                                />
                                {p}
                            </label>
                        ))}
                    </fieldset>
                )}
                <button
                    type="submit"
                    className={FORM_BTN_ACCENT}
                    disabled={!canSubmit}
                >
                    {t("addButton")}
                </button>
            </form>
        </div>
    );
}

function Recommendations() {
    const t = useTranslations("suggestions");
    const tRecs = useTranslations("recommendations");
    const { state, derived } = useClue();
    const setup = state.setup;
    const result = derived.deductionResult;
    const [asPlayer, setAsPlayer] = useState<string>(
        setup.players[0] ?? "",
    );

    useEffect(() => {
        if (asPlayer && setup.players.some(p => String(p) === asPlayer))
            return;
        setAsPlayer(setup.players[0] ?? "");
    }, [setup.players, asPlayer]);

    const knowledge = Result.getOrUndefined(result);
    if (knowledge === undefined || !asPlayer) {
        return (
            <div>
                <h3 className={SECTION_TITLE}>
                    {t("recommendationsTitle")}
                </h3>
                <div className="text-[13px] text-muted">
                    {knowledge === undefined
                        ? t("resolveContradictionFirst")
                        : t("addPlayersFirst")}
                </div>
            </div>
        );
    }

    const rec = recommendSuggestions(
        setup,
        knowledge,
        Player(asPlayer),
        50,
    );
    const consolidated = consolidateRecommendations(
        setup,
        knowledge,
        rec.recommendations,
    ).slice(0, 5);

    return (
        <div>
            <h3 className={SECTION_TITLE}>
                {t("recommendationsTitle")}
            </h3>
            <label className={LABEL_ROW}>
                {t("suggestingAs")}
                <select
                    value={asPlayer}
                    onChange={e => setAsPlayer(e.currentTarget.value)}
                    className={SELECT_CLASS}
                >
                    {setup.players.map(p => (
                        <option key={p} value={p}>
                            {p}
                        </option>
                    ))}
                </select>
            </label>
            {consolidated.length === 0 ? (
                <div className="mt-2 text-[13px] text-muted">
                    {t("nothingUseful")}
                </div>
            ) : (
                <ol className="mt-2 list-decimal pl-6 text-[13px]">
                    {consolidated.map((r, i) => {
                        const desc = describeRecommendation(
                            setup,
                            knowledge,
                            {
                                cards: r.cards.flatMap(c =>
                                    c === "any" ? [] : [c],
                                ),
                                cellInfoScore: r.cellInfoScore,
                                caseFileOpennessScore: r.caseFileOpennessScore,
                                refuterUncertaintyScore: r.refuterUncertaintyScore,
                            },
                        );
                        const explanation = tRecs(desc.kind, desc.params);
                        const scoreBreakdown = (
                            <div>
                                <div className="font-semibold">
                                    {t("scoreBreakdownHeader", {
                                        score: r.score,
                                    })}
                                </div>
                                <div className="mt-1 text-muted">
                                    {t("scoreBreakdownDetails", {
                                        info: r.cellInfoScore,
                                        combos: r.caseFileOpennessScore,
                                        refuters: r.refuterUncertaintyScore,
                                    })}
                                </div>
                                {r.groupSize > 1 && (
                                    <div className="mt-1 text-muted">
                                        {t("scoreBreakdownCoverage", {
                                            count: r.groupSize,
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                        return (
                            <Tooltip key={i} content={scoreBreakdown}>
                            <li className="py-1.5">
                                <div>
                                    {r.cards.map((c, ci) => {
                                        const rawName =
                                            setup.categories[ci]?.name ?? "card";
                                        // Category names are typically plural
                                        // ("Weapons", "Rooms"); strip a trailing
                                        // "s" so the collapsed label reads as
                                        // "any weapon / room" rather than
                                        // "any weapons / rooms".
                                        const singular = rawName.replace(
                                            /s$/,
                                            "",
                                        ).toLowerCase();
                                        return (
                                            <span key={ci}>
                                                {ci > 0 && " + "}
                                                {c === "any" ? (
                                                    <em className="text-muted">
                                                        {t("anyCategory", {
                                                            category: singular,
                                                        })}
                                                    </em>
                                                ) : (
                                                    <strong>
                                                        {cardName(setup, c)}
                                                    </strong>
                                                )}
                                            </span>
                                        );
                                    })}
                                    <span className="ml-1 text-muted">
                                        {t("score", { score: r.score })}
                                    </span>
                                </div>
                                <div className="text-[12px] text-muted">
                                    {explanation}
                                </div>
                            </li>
                            </Tooltip>
                        );
                    })}
                </ol>
            )}
        </div>
    );
}

function PriorSuggestions() {
    const t = useTranslations("suggestions");
    const { state, dispatch } = useClue();
    const { hoveredSuggestionIndex, setHoveredSuggestion } = useHover();
    const setup = state.setup;
    const suggestions = state.suggestions;
    const [editingId, setEditingId] = useState<string | null>(null);
    return (
        <div className="mt-4 border-t border-border pt-4">
            <h3 className={SECTION_TITLE}>
                {t("priorTitle")}
                {suggestions.length > 0
                    ? t("priorTitleCount", { count: suggestions.length })
                    : ""}
            </h3>
            {suggestions.length === 0 ? (
                <div className="text-[13px] text-muted">
                    {t("priorEmpty")}
                </div>
            ) : (
                <ol className="m-0 max-h-[300px] list-decimal overflow-y-auto pl-6">
                    {suggestions.map((s, idx) => {
                        const isHovered = hoveredSuggestionIndex === idx;
                        const highlightClass = isHovered
                            ? " -mx-2 rounded bg-yes-bg/40 px-2 ring-1 ring-accent/60"
                            : "";
                        return editingId === s.id ? (
                            <li
                                key={s.id}
                                className="border-b border-border py-2 text-[13px] last:border-b-0"
                            >
                                <EditSuggestionRow
                                    suggestion={s}
                                    onSave={updated => {
                                        dispatch({
                                            type: "updateSuggestion",
                                            suggestion: updated,
                                        });
                                        setEditingId(null);
                                    }}
                                    onCancel={() => setEditingId(null)}
                                />
                            </li>
                        ) : (
                            <li
                                key={s.id}
                                className={
                                    "border-b border-border py-2 text-[13px] last:border-b-0 transition-[background-color,box-shadow] duration-100" +
                                    highlightClass
                                }
                                onMouseEnter={() => setHoveredSuggestion(idx)}
                                onMouseLeave={() => setHoveredSuggestion(null)}
                            >
                                <div>
                                    {t.rich("suggestedLine", {
                                        suggester: String(s.suggester),
                                        cards: s.cards
                                            .map(id => cardName(setup, id))
                                            .join(" + "),
                                        strong: chunks => (
                                            <strong>{chunks}</strong>
                                        ),
                                    })}
                                </div>
                                <div className="text-[13px] text-muted">
                                    {s.refuter ? (
                                        <>
                                            {t.rich("refutedByLine", {
                                                player: String(s.refuter),
                                                strong: chunks => (
                                                    <strong>{chunks}</strong>
                                                ),
                                            })}
                                            {s.seenCard &&
                                                t("showedLine", {
                                                    card: cardName(
                                                        setup,
                                                        s.seenCard,
                                                    ),
                                                })}
                                        </>
                                    ) : (
                                        t("nobodyCouldRefute")
                                    )}
                                    {s.nonRefuters.length > 0 &&
                                        t("passedLine", {
                                            players: s.nonRefuters.join(", "),
                                        })}
                                </div>
                                <div className="mt-1 flex gap-2">
                                    <button
                                        type="button"
                                        className="cursor-pointer border-none bg-transparent p-0 text-[12px] text-accent underline"
                                        onClick={() =>
                                            setEditingId(s.id)
                                        }
                                    >
                                        {t("editAction")}
                                    </button>
                                    <button
                                        type="button"
                                        className="cursor-pointer border-none bg-transparent p-0 text-[12px] text-danger underline"
                                        onClick={() =>
                                            dispatch({
                                                type: "removeSuggestion",
                                                id: s.id,
                                            })
                                        }
                                    >
                                        {t("removeAction")}
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ol>
            )}
        </div>
    );
}

function EditSuggestionRow({
    suggestion,
    onSave,
    onCancel,
}: {
    suggestion: DraftSuggestion;
    onSave: (updated: DraftSuggestion) => void;
    onCancel: () => void;
}) {
    const t = useTranslations("suggestions");
    const { state } = useClue();
    const setup = state.setup;
    const [suggester, setSuggester] = useState(String(suggestion.suggester));
    const [cardByCategory, setCardByCategory] = useState<
        Map<string, string>
    >(pickCardsByCategory(suggestion, setup));
    const [refuter, setRefuter] = useState(
        suggestion.refuter ? String(suggestion.refuter) : "",
    );
    const [seenCard, setSeenCard] = useState(
        suggestion.seenCard ? String(suggestion.seenCard) : "",
    );
    const [passedPlayers, setPassedPlayers] = useState<Set<string>>(
        new Set(suggestion.nonRefuters.map(p => String(p))),
    );

    const canSave =
        suggester !== "" &&
        setup.categories.length > 0 &&
        setup.categories.every(
            c => (cardByCategory.get(String(c.id)) ?? "") !== "",
        );

    const setCardForCategory = (categoryName: string, value: string) => {
        const next = new Map(cardByCategory);
        if (value === "") next.delete(categoryName);
        else next.set(categoryName, value);
        setCardByCategory(next);
    };

    const onRefuterChange = (value: string) => {
        setRefuter(value);
        setSeenCard("");
        const next = new Set(passedPlayers);
        next.delete(value);
        setPassedPlayers(next);
    };

    const togglePassed = (name: string, checked: boolean) => {
        const next = new Set(passedPlayers);
        if (checked) next.add(name);
        else next.delete(name);
        setPassedPlayers(next);
    };

    const handleSave = () => {
        if (!canSave) return;
        const cards = setup.categories.map(c =>
            Card(cardByCategory.get(String(c.id)) ?? ""),
        );
        const nonRefuters = setup.players.filter(p =>
            passedPlayers.has(String(p)),
        );
        onSave({
            ...suggestion,
            suggester: Player(suggester),
            cards,
            nonRefuters,
            refuter: refuter ? Player(refuter) : undefined,
            seenCard: seenCard ? Card(seenCard) : undefined,
        });
    };

    const eligibleForPassed = setup.players.filter(
        p => String(p) !== suggester && String(p) !== refuter,
    );

    const pickedCards = setup.categories
        .map(c => cardByCategory.get(String(c.id)) ?? "")
        .filter(c => c !== "");

    return (
        <div className="py-2">
            <div className="flex flex-col gap-1.5">
                <label className={LABEL_ROW}>
                    {t("suggesterLabel")}
                    <select
                        value={suggester}
                        onChange={e =>
                            setSuggester(e.currentTarget.value)
                        }
                        className={SELECT_CLASS}
                    >
                        {setup.players.map(p => (
                            <option key={p} value={p}>
                                {p}
                            </option>
                        ))}
                    </select>
                </label>
                {setup.categories.map(category => {
                    const catKey = String(category.id);
                    const value = cardByCategory.get(catKey) ?? "";
                    return (
                        <label key={catKey} className={LABEL_ROW}>
                            {t("categoryLabel", { category: category.name })}
                            <select
                                value={value}
                                onChange={e =>
                                    setCardForCategory(
                                        catKey,
                                        e.currentTarget.value,
                                    )
                                }
                                className={SELECT_CLASS}
                            >
                                <option value="">
                                    {t("placeholderOption")}
                                </option>
                                {category.cards.map(entry => (
                                    <option
                                        key={String(entry.id)}
                                        value={String(entry.id)}
                                    >
                                        {entry.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    );
                })}
                <label className={LABEL_ROW}>
                    {t("refutedByLabel")}
                    <select
                        value={refuter}
                        onChange={e =>
                            onRefuterChange(e.currentTarget.value)
                        }
                        className={SELECT_CLASS}
                    >
                        <option value="">{t("noneOption")}</option>
                        {setup.players
                            .filter(p => String(p) !== suggester)
                            .map(p => (
                                <option key={p} value={p}>
                                    {p}
                                </option>
                            ))}
                    </select>
                </label>
                {refuter && (
                    <label className={LABEL_ROW}>
                        {t("cardShownEditLabel")}
                        <select
                            value={seenCard}
                            onChange={e =>
                                setSeenCard(e.currentTarget.value)
                            }
                            className={SELECT_CLASS}
                        >
                            <option value="">{t("unknownOption")}</option>
                            {pickedCards.map(c => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                {eligibleForPassed.length > 0 && (
                    <fieldset className="my-1 rounded-[var(--radius)] border border-border px-3 py-2">
                        <legend className="px-1 text-[13px] font-semibold">
                            {t("couldNotRefute")}
                        </legend>
                        {eligibleForPassed.map(p => (
                            <label
                                key={p}
                                className="flex cursor-pointer items-center gap-1.5 py-0.5 text-[13px]"
                            >
                                <input
                                    type="checkbox"
                                    className="m-0"
                                    checked={passedPlayers.has(String(p))}
                                    onChange={e =>
                                        togglePassed(
                                            String(p),
                                            e.currentTarget.checked,
                                        )
                                    }
                                />
                                {p}
                            </label>
                        ))}
                    </fieldset>
                )}
            </div>
            <div className="mt-2 flex gap-2">
                <button
                    type="button"
                    className="cursor-pointer rounded border-none bg-accent px-3.5 py-1 text-[13px] text-white disabled:cursor-not-allowed disabled:bg-unknown"
                    disabled={!canSave}
                    onClick={handleSave}
                >
                    {t("saveAction")}
                </button>
                <button
                    type="button"
                    className={FORM_BTN_GHOST}
                    onClick={onCancel}
                >
                    {t("cancelAction")}
                </button>
            </div>
        </div>
    );
}
