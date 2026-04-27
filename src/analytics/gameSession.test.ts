/**
 * Tests for the analytics-session bookkeeping. The module holds
 * mutable singleton state, so each test re-imports a fresh module
 * via `vi.resetModules()` to avoid bleed-through.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
    vi.resetModules();
});

const importFresh = async () => await import("./gameSession");

describe("gameSession", () => {
    it("starts with isFirstSession=true and gameId=0 semantics", async () => {
        const { isFirstSession, claimGameStarted, claimCaseFileSolved } =
            await importFresh();
        expect(isFirstSession()).toBe(true);
        // Claims return false until startSetup() opens a session.
        expect(claimGameStarted()).toBe(false);
        expect(claimCaseFileSolved()).toBe(false);
    });

    it("startSetup arms claims and flips isFirstSession", async () => {
        const {
            startSetup,
            isFirstSession,
            claimGameStarted,
            claimCaseFileSolved,
        } = await importFresh();
        startSetup();
        expect(isFirstSession()).toBe(false);
        expect(claimGameStarted()).toBe(true);
        expect(claimCaseFileSolved()).toBe(true);
    });

    it("each claim returns true exactly once per gameId", async () => {
        const { startSetup, claimGameStarted, claimCaseFileSolved } =
            await importFresh();
        startSetup();
        expect(claimGameStarted()).toBe(true);
        expect(claimGameStarted()).toBe(false);
        expect(claimGameStarted()).toBe(false);
        expect(claimCaseFileSolved()).toBe(true);
        expect(claimCaseFileSolved()).toBe(false);
    });

    it("a new startSetup re-arms claims for the new game", async () => {
        const { startSetup, claimGameStarted, claimCaseFileSolved } =
            await importFresh();
        startSetup();
        expect(claimGameStarted()).toBe(true);
        expect(claimCaseFileSolved()).toBe(true);
        startSetup();
        expect(claimGameStarted()).toBe(true);
        expect(claimCaseFileSolved()).toBe(true);
    });

    it("setupDurationMs returns 0 before the first startSetup", async () => {
        const { setupDurationMs } = await importFresh();
        expect(setupDurationMs()).toBe(0);
    });

    it("setupDurationMs returns elapsed ms after startSetup", async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date(1_700_000_000_000));
            const { startSetup, setupDurationMs } = await importFresh();
            startSetup();
            vi.setSystemTime(new Date(1_700_000_002_500));
            expect(setupDurationMs()).toBe(2_500);
        } finally {
            vi.useRealTimers();
        }
    });

    it("gameDurationMs returns 0 before claimGameStarted has succeeded", async () => {
        const { startSetup, gameDurationMs } = await importFresh();
        // Even after startSetup, gameDurationMs is 0 — it's gated on
        // claimGameStarted, which fires when uiMode flips to checklist.
        startSetup();
        expect(gameDurationMs()).toBe(0);
    });

    it("gameDurationMs returns elapsed ms after claimGameStarted succeeds", async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date(1_700_000_000_000));
            const { startSetup, claimGameStarted, gameDurationMs } =
                await importFresh();
            startSetup();
            vi.setSystemTime(new Date(1_700_000_005_000));
            expect(claimGameStarted()).toBe(true);
            vi.setSystemTime(new Date(1_700_000_007_500));
            expect(gameDurationMs()).toBe(2_500);
        } finally {
            vi.useRealTimers();
        }
    });
});
