/**
 * Pinned tests for analytics-side-effects that aren't otherwise
 * exercised end-to-end. Today: teach-mode person properties + the
 * super-property register helper.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const captureCalls: Array<{
    event: string;
    props: Record<string, unknown> | undefined;
}> = [];
const registerCalls: Array<Record<string, unknown>> = [];

vi.mock("./posthog", () => ({
    posthog: {
        __loaded: true,
        capture: (event: string, props?: Record<string, unknown>): void => {
            captureCalls.push({ event, props });
        },
        register: (props: Record<string, unknown>): void => {
            registerCalls.push(props);
        },
    },
    registerSuperProperties: (props: Record<string, unknown>): void => {
        registerCalls.push(props);
    },
}));

beforeEach(() => {
    captureCalls.length = 0;
    registerCalls.length = 0;
});

afterEach(() => {
    vi.resetModules();
});

describe("teachModeEnabled person properties", () => {
    test("emits the event with $set + $set_once payload", async () => {
        const { teachModeEnabled } = await import("./events");
        teachModeEnabled({ source: "wizard" });

        expect(captureCalls).toHaveLength(1);
        const props = captureCalls[0]!.props ?? {};
        expect(captureCalls[0]!.event).toBe("teach_mode_enabled");
        expect(props["source"]).toBe("wizard");

        // $set is for "latest value matters" — last_teach_mode_enabled_at
        // updates on every enable so we can cohort by recency.
        const set = props["$set"] as Record<string, unknown>;
        expect(typeof set["last_teach_mode_enabled_at"]).toBe("string");

        // $set_once locks in the first-touch flags. PostHog ignores
        // subsequent writes from the SDK, so toggling teach-mode off
        // and back on doesn't overwrite the original first-enable
        // timestamp or flip the user back to "not a teach-mode user".
        const setOnce = props["$set_once"] as Record<string, unknown>;
        expect(setOnce["is_teach_mode_user"]).toBe(true);
        expect(typeof setOnce["first_teach_mode_enabled_at"]).toBe("string");
    });

    test("midGameAction passes through to the event", async () => {
        const { teachModeEnabled } = await import("./events");
        teachModeEnabled({
            source: "overflowMenu",
            midGameAction: "keepDeduced",
        });
        const props = captureCalls[0]!.props ?? {};
        expect(props["midGameAction"]).toBe("keepDeduced");
    });
});

describe("registerSuperProperties", () => {
    test("forwards the props to posthog.register", async () => {
        const { registerSuperProperties } = await import("./posthog");
        registerSuperProperties({ teach_mode_active: true });
        expect(registerCalls).toEqual([{ teach_mode_active: true }]);
    });
});
