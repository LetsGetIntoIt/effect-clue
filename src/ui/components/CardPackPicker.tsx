"use client";

import * as RadixPopover from "@radix-ui/react-popover";
import { useTranslations } from "next-intl";
import {
    type ReactNode,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import { ShareIcon } from "./ShareIcon";
import { PencilIcon, TrashIcon } from "./Icons";

/**
 * Pack-shaped record consumed by the picker. Custom packs carry
 * `isCustom: true` so the picker can render the per-row delete button
 * for those rows only; built-in packs (Classic, Master Detective)
 * stay non-deletable.
 */
export interface PickerPack {
    readonly id: string;
    readonly label: string;
    readonly isCustom: boolean;
}

interface CardPackPickerProps {
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    /** Packs already in the order they should appear (Classic first). */
    readonly packs: ReadonlyArray<PickerPack>;
    readonly onSelect: (pack: PickerPack) => void;
    readonly onDeleteCustomPack: (pack: PickerPack) => void;
    /**
     * Per-row rename for custom packs. Built-ins don't surface this —
     * the picker only renders the pencil button when both
     * `onRenameCustomPack` is provided AND `pack.isCustom` is true.
     */
    readonly onRenameCustomPack?: (pack: PickerPack) => void;
    /**
     * Optional per-row "Share this pack" handler. When provided, every
     * pack row gets a small share-icon button alongside the delete one.
     * Custom packs and built-ins both surface the affordance — sharing
     * a built-in is still a valid use case (a friend without the same
     * default lineup can import the deck).
     */
    readonly onSharePack?: (pack: PickerPack) => void;
    /**
     * Id of the pack whose contents match the active deck. Rendered with
     * a subtle accent treatment so the user can see which pack the
     * current table is — even when scrolling through the full list.
     */
    readonly activeMatchId?: string | undefined;
    /** The trigger element; rendered via Radix `asChild`. */
    readonly children: ReactNode;
}

const matchesQuery = (label: string, query: string): boolean =>
    label.toLowerCase().includes(query.toLowerCase());

/**
 * Typeahead dropdown listing every card pack the user has access to,
 * with search-as-you-type filtering and arrow-key navigation. Built
 * on `@radix-ui/react-popover` (already used by `InfoPopover`) plus a
 * controlled search input — keeps the dependency surface small and
 * matches the existing component-composition style.
 *
 * Controlled API: callers own `open` and `onOpenChange` so the
 * trigger pill in `CardPackRow` can stay styled and laid out
 * alongside the other surface pills.
 *
 * Keyboard model on the search input:
 *   - ArrowDown / ArrowUp: move highlight, wrap at the ends.
 *   - Home / End: jump to first / last visible match.
 *   - Enter: activate the highlighted row (select + close).
 *   - Escape: close without selecting.
 *   - Typing: filter case-insensitively; highlight resets to 0.
 */
export function CardPackPicker({
    open,
    onOpenChange,
    packs,
    onSelect,
    onDeleteCustomPack,
    onRenameCustomPack,
    onSharePack,
    activeMatchId,
    children,
}: CardPackPickerProps) {
    const t = useTranslations("setup");
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listboxId = useId();
    const optionIdPrefix = useId();
    const optionId = (idx: number) => `${optionIdPrefix}-opt-${idx}`;

    const filtered = useMemo(() => {
        const q = query.trim();
        if (!q) return packs;
        return packs.filter(p => matchesQuery(p.label, q));
    }, [packs, query]);

    // Reset state every time the picker opens so the user starts on
    // an empty filter with the first row highlighted, regardless of
    // what they did last time.
    useEffect(() => {
        if (!open) return;
        setQuery("");
        setActiveIndex(0);
    }, [open]);

    // Clamp the active index whenever the filtered list shrinks past
    // the current highlight — otherwise an Enter would activate
    // nothing (or the wrong row).
    useEffect(() => {
        if (activeIndex >= filtered.length) {
            setActiveIndex(filtered.length === 0 ? 0 : filtered.length - 1);
        }
    }, [filtered.length, activeIndex]);

    const select = (pack: PickerPack) => {
        onSelect(pack);
        onOpenChange(false);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (filtered.length === 0) return;
            setActiveIndex(i => (i + 1) % filtered.length);
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            if (filtered.length === 0) return;
            setActiveIndex(i => (i - 1 + filtered.length) % filtered.length);
            return;
        }
        if (e.key === "Home") {
            e.preventDefault();
            setActiveIndex(0);
            return;
        }
        if (e.key === "End") {
            e.preventDefault();
            if (filtered.length === 0) return;
            setActiveIndex(filtered.length - 1);
            return;
        }
        if (e.key === "Enter") {
            const target = filtered[activeIndex];
            if (target) {
                e.preventDefault();
                select(target);
            }
            return;
        }
        // Escape is handled by Radix Popover's onOpenChange.
    };

    const activeId =
        filtered.length > 0 && activeIndex < filtered.length
            ? optionId(activeIndex)
            : undefined;

    return (
        <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
            <RadixPopover.Trigger asChild>{children}</RadixPopover.Trigger>
            <RadixPopover.Portal>
                <RadixPopover.Content
                    side="bottom"
                    align="start"
                    sideOffset={6}
                    collisionPadding={8}
                    onOpenAutoFocus={e => {
                        // Prevent Radix from focusing the first focusable
                        // descendant — we want focus on the search input,
                        // which we drive ourselves via the ref below.
                        e.preventDefault();
                        inputRef.current?.focus();
                    }}
                    className={
                        "z-[var(--z-popover)] w-[min(90vw,320px)] rounded-[var(--radius)] border border-border bg-panel " +
                        "shadow-[0_6px_16px_rgba(0,0,0,0.18)] focus:outline-none"
                    }
                >
                    <div className="flex flex-col">
                        <div className="border-b border-border p-2">
                            <input
                                ref={inputRef}
                                type="text"
                                role="combobox"
                                aria-expanded="true"
                                aria-controls={listboxId}
                                aria-autocomplete="list"
                                aria-activedescendant={activeId}
                                aria-label={t("cardPackSearchAria")}
                                placeholder={t("cardPackSearchPlaceholder")}
                                value={query}
                                onChange={e => {
                                    setQuery(e.target.value);
                                    setActiveIndex(0);
                                }}
                                onKeyDown={onKeyDown}
                                className={
                                    "tap-target-compact text-tap-compact w-full rounded border border-border bg-white " +
                                    "focus:border-accent focus:outline-none"
                                }
                            />
                        </div>
                        {filtered.length === 0 ? (
                            <div
                                role="status"
                                className="px-3 py-3 text-[1rem] text-muted"
                            >
                                {t("cardPackSearchEmpty", { query: query.trim() })}
                            </div>
                        ) : (
                            <ul
                                id={listboxId}
                                role="listbox"
                                aria-label={t("cardPackSearchAria")}
                                className="m-0 max-h-[260px] list-none overflow-y-auto p-1"
                            >
                                {filtered.map((pack, idx) => {
                                    const isHighlighted = idx === activeIndex;
                                    const isActiveMatch =
                                        pack.id === activeMatchId;
                                    return (
                                        <li
                                            key={pack.id}
                                            id={optionId(idx)}
                                            role="option"
                                            aria-selected={isHighlighted}
                                            data-card-pack-active={
                                                isActiveMatch ? "true" : undefined
                                            }
                                            className={
                                                "tap-target-compact text-tap-compact flex items-stretch justify-between rounded " +
                                                (isHighlighted ? "bg-hover " : "") +
                                                (isActiveMatch
                                                    ? "border-l-2 border-accent text-accent font-semibold"
                                                    : "border-l-2 border-transparent")
                                            }
                                            onMouseEnter={() => setActiveIndex(idx)}
                                        >
                                            <button
                                                type="button"
                                                className="flex-1 cursor-pointer truncate self-center text-left py-1"
                                                onClick={() => select(pack)}
                                                title={t("loadCustomCardSetTitle", {
                                                    label: pack.label,
                                                })}
                                                aria-pressed={isActiveMatch}
                                            >
                                                {pack.label}
                                            </button>
                                            {onSharePack ? (
                                                <button
                                                    type="button"
                                                    className="ml-1 inline-flex cursor-pointer items-center self-stretch rounded px-2.5 text-muted hover:bg-white hover:text-accent"
                                                    onClick={() =>
                                                        onSharePack(pack)
                                                    }
                                                    title={t(
                                                        "sharePackTitle",
                                                        { label: pack.label },
                                                    )}
                                                    aria-label={t(
                                                        "sharePackAria",
                                                        { label: pack.label },
                                                    )}
                                                >
                                                    <ShareIcon size={15} />
                                                </button>
                                            ) : null}
                                            {pack.isCustom && onRenameCustomPack ? (
                                                <button
                                                    type="button"
                                                    className="ml-1 inline-flex cursor-pointer items-center self-stretch rounded px-2.5 text-muted hover:bg-white hover:text-accent"
                                                    onClick={() =>
                                                        onRenameCustomPack(pack)
                                                    }
                                                    title={t(
                                                        "renamePackTitle",
                                                        { label: pack.label },
                                                    )}
                                                    aria-label={t(
                                                        "renamePackAria",
                                                        { label: pack.label },
                                                    )}
                                                >
                                                    <PencilIcon size={15} />
                                                </button>
                                            ) : null}
                                            {pack.isCustom ? (
                                                <button
                                                    type="button"
                                                    className="ml-1 inline-flex cursor-pointer items-center self-stretch rounded px-2.5 text-muted hover:bg-white hover:text-danger"
                                                    onClick={() =>
                                                        onDeleteCustomPack(pack)
                                                    }
                                                    title={t(
                                                        "deleteCustomCardSetTitle",
                                                        { label: pack.label },
                                                    )}
                                                    aria-label={t(
                                                        "deleteCustomCardSetAria",
                                                        { label: pack.label },
                                                    )}
                                                >
                                                    <TrashIcon size={15} />
                                                </button>
                                            ) : null}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </RadixPopover.Content>
            </RadixPopover.Portal>
        </RadixPopover.Root>
    );
}
