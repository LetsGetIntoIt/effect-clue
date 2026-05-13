import type { UiMode } from "../logic/ClueState";

// Per-uiMode scroll memory. Module-scoped so the two `newGame`
// dispatch sites (NewGameShortcut, SetupWizard.onStartOver) can
// import `resetScrollMemory` directly. Reload resets to defaults
// because module state is per-page-load.
const positions: Record<UiMode, number> = {
    setup: 0,
    checklist: 0,
    suggest: 0,
};

export const recordScroll = (mode: UiMode, y: number): void => {
    positions[mode] = y;
};

export const getScroll = (mode: UiMode): number => positions[mode];

export const resetScrollMemory = (): void => {
    positions.setup = 0;
    positions.checklist = 0;
    positions.suggest = 0;
};
