"use client";

/**
 * Single source of truth for every keyboard shortcut in the app.
 *
 * Each binding owns both sides of the contract:
 *   - `match(event)`: predicate used by handlers
 *   - `label`: display string shown in the UI next to the action
 *
 * A binding can carry multiple combos. The first combo's label is
 * canonical (what UI labels show by default); any combo may match the
 * event. This lets alternate keys (e.g. W/A/S/D, I/J/K/L) share a
 * binding with the arrow keys without duplicating handler logic.
 *
 * The active map is module-scoped and mutable so a future settings UI
 * can swap it in place — call sites keep using `matches(id, e)` and
 * `label(id)` and update automatically.
 */

import { useEffect } from "react";

type KeyCombo = {
    readonly label: string;
    readonly match: (e: KeyboardEvent) => boolean;
};

type KeyBinding = {
    readonly id: string;
    readonly description: string;
    readonly combos: ReadonlyArray<KeyCombo>;
};

// ---- Combo factories ---------------------------------------------------

const hasMod = (e: KeyboardEvent): boolean => e.metaKey || e.ctrlKey;

/** Cmd/Ctrl + key (exact; no Shift/Alt). Case-insensitive key. */
function mod(key: string, label: string): KeyCombo {
    const k = key.toLowerCase();
    return {
        label,
        match: e =>
            hasMod(e) &&
            !e.shiftKey &&
            !e.altKey &&
            e.key.toLowerCase() === k,
    };
}

/** Cmd/Ctrl + Shift + key. Case-insensitive key. */
function modShift(key: string, label: string): KeyCombo {
    const k = key.toLowerCase();
    return {
        label,
        match: e =>
            hasMod(e) &&
            e.shiftKey &&
            !e.altKey &&
            e.key.toLowerCase() === k,
    };
}

/** Bare key (no modifiers). Matches the exact key value. */
function bare(key: string, label: string): KeyCombo {
    return {
        label,
        match: e =>
            !e.metaKey &&
            !e.ctrlKey &&
            !e.altKey &&
            !e.shiftKey &&
            e.key === key,
    };
}

/** Bare key (no modifiers), case-insensitive. For A-Z letter keys. */
function bareCI(key: string, label: string): KeyCombo {
    const k = key.toLowerCase();
    return {
        label,
        match: e =>
            !e.metaKey &&
            !e.ctrlKey &&
            !e.altKey &&
            !e.shiftKey &&
            e.key.toLowerCase() === k,
    };
}

/** Cmd/Ctrl+Enter — form submit. */
function modEnter(label: string): KeyCombo {
    return {
        label,
        match: e => hasMod(e) && e.key === "Enter",
    };
}

const combo = { mod, modShift, bare, bareCI, modEnter };

// ---- Binding IDs -------------------------------------------------------

type BindingId =
    // Global (window-level)
    | "global.undo"
    | "global.redo"
    | "global.newGame"
    | "global.gotoSetup"
    | "global.gotoPlay"
    | "global.gotoAccusation"
    | "global.gotoChecklist"
    | "global.gotoPriorLog"
    // Navigation primitives (scoped)
    | "nav.up"
    | "nav.down"
    | "nav.left"
    | "nav.right"
    | "nav.home"
    | "nav.end"
    // Action primitives (scoped)
    | "action.toggle"
    | "action.commit"
    | "action.remove"
    | "action.cancel"
    | "action.submit";

// ---- Default keymap ----------------------------------------------------

const DEFAULT_KEY_MAP: Record<BindingId, KeyBinding> = {
    "global.undo": {
        id: "global.undo",
        description: "Undo the last change",
        combos: [combo.mod("z", "⌘Z")],
    },
    "global.redo": {
        id: "global.redo",
        description: "Redo the next change",
        combos: [combo.modShift("z", "⌘⇧Z")],
    },
    "global.newGame": {
        id: "global.newGame",
        description: "Start a new game",
        combos: [combo.modShift("Backspace", "⌘⇧⌫")],
    },
    "global.gotoSetup": {
        id: "global.gotoSetup",
        description: "Jump to the Setup tab",
        combos: [combo.mod("h", "⌘H")],
    },
    "global.gotoPlay": {
        id: "global.gotoPlay",
        description: "Jump to the suggestion form",
        combos: [combo.mod("k", "⌘K")],
    },
    "global.gotoAccusation": {
        id: "global.gotoAccusation",
        description: "Jump to the failed-accusation form",
        combos: [combo.mod("i", "⌘I")],
    },
    "global.gotoChecklist": {
        id: "global.gotoChecklist",
        description: "Jump to the checklist",
        combos: [combo.mod("j", "⌘J")],
    },
    "global.gotoPriorLog": {
        id: "global.gotoPriorLog",
        description: "Jump to the prior suggestions log",
        combos: [combo.mod("l", "⌘L")],
    },
    "nav.up": {
        id: "nav.up",
        description: "Move up",
        combos: [
            combo.bare("ArrowUp", "↑"),
            combo.bareCI("w", "W"),
            combo.bareCI("i", "I"),
        ],
    },
    "nav.down": {
        id: "nav.down",
        description: "Move down",
        combos: [
            combo.bare("ArrowDown", "↓"),
            combo.bareCI("s", "S"),
            combo.bareCI("k", "K"),
        ],
    },
    "nav.left": {
        id: "nav.left",
        description: "Move left",
        combos: [
            combo.bare("ArrowLeft", "←"),
            combo.bareCI("a", "A"),
            combo.bareCI("j", "J"),
        ],
    },
    "nav.right": {
        id: "nav.right",
        description: "Move right",
        combos: [
            combo.bare("ArrowRight", "→"),
            combo.bareCI("d", "D"),
            combo.bareCI("l", "L"),
        ],
    },
    "nav.home": {
        id: "nav.home",
        description: "Jump to first",
        combos: [combo.bare("Home", "Home")],
    },
    "nav.end": {
        id: "nav.end",
        description: "Jump to last",
        combos: [combo.bare("End", "End")],
    },

    "action.toggle": {
        id: "action.toggle",
        description: "Toggle the focused item",
        combos: [combo.bare(" ", "Space"), combo.bare("Enter", "Enter")],
    },
    "action.commit": {
        id: "action.commit",
        description: "Commit the current selection",
        combos: [combo.bare("Enter", "Enter")],
    },
    "action.remove": {
        id: "action.remove",
        description: "Remove the focused item",
        combos: [combo.bare("Delete", "Delete"), combo.bare("Backspace", "⌫")],
    },
    "action.cancel": {
        id: "action.cancel",
        description: "Cancel / exit",
        combos: [combo.bare("Escape", "Esc")],
    },
    "action.submit": {
        id: "action.submit",
        description: "Submit the form",
        combos: [combo.modEnter("⌘↵")],
    },
};

// ---- Active map + accessors --------------------------------------------

let activeKeyMap: Record<BindingId, KeyBinding> = DEFAULT_KEY_MAP;

/** True if the event matches any combo on the binding. */
export function matches(id: BindingId, e: KeyboardEvent): boolean {
    return activeKeyMap[id].combos.some(c => c.match(e));
}

/** Canonical display label (first combo). Safe on empty combos. */
export function label(id: BindingId, index = 0): string {
    return activeKeyMap[id].combos[index]?.label ?? "";
}

/**
 * Returns " ({label})" when the device has a keyboard, otherwise "".
 * Lets i18n templates carry a `{shortcut}` placeholder that's a
 * complete trailing fragment — including its leading space and parens
 * — so a touch-only device renders the bare label without dangling
 * empty parens.
 *
 * Pair with the `useHasKeyboard()` hook at the call site.
 */
export function shortcutSuffix(id: BindingId, hasKeyboard: boolean): string {
    return hasKeyboard ? ` (${label(id)})` : "";
}

// ---- React hook --------------------------------------------------------

/**
 * Attach a window-level keydown listener that fires only when the event
 * matches the binding. preventDefault is applied automatically on match.
 * Pass the handler memoized (useCallback) to avoid re-registering.
 */
export function useGlobalShortcut(
    id: BindingId,
    handler: (e: KeyboardEvent) => void,
): void {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!matches(id, e)) return;
            e.preventDefault();
            handler(e);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [id, handler]);
}
