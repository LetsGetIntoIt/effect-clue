/**
 * The component is a thin wrapper around `navigator.serviceWorker.register()`.
 * Coverage targets the three control-flow branches that matter:
 *
 *   1. Production + supported browser → calls `register("/sw.js", ...)`.
 *   2. Development → does NOT call `register` (Serwist disables SW emit
 *      in dev too, so calling it would fail anyway).
 *   3. No `serviceWorker` on `navigator` (Safari ITP, locked-down
 *      enterprise browsers) → does NOT call `register` and does NOT
 *      throw.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const ORIGINAL_NODE_ENV = process.env["NODE_ENV"];

const setNodeEnv = (value: string): void => {
    // Vitest's `process.env` is a plain object — direct assignment
    // works; `Object.defineProperty` does not.
    (process.env as Record<string, string>)["NODE_ENV"] = value;
};

type NavigatorWithSW = {
    serviceWorker?: { register: ReturnType<typeof vi.fn> };
};

const navWithSW = (): NavigatorWithSW =>
    window.navigator as unknown as NavigatorWithSW;

beforeEach(() => {
    // jsdom doesn't ship `navigator.serviceWorker`; assign a stub
    // per-test so we can assert against the spy.
    navWithSW().serviceWorker = {
        register: vi.fn().mockResolvedValue({ scope: "/" }),
    };
});

afterEach(() => {
    setNodeEnv(ORIGINAL_NODE_ENV ?? "test");
    delete navWithSW().serviceWorker;
    vi.restoreAllMocks();
});

const importComponent = async (): Promise<
    typeof import("./ServiceWorkerRegistration").ServiceWorkerRegistration
> => {
    // Reset module so the `process.env.NODE_ENV` check inside the
    // component re-reads the freshly-set value on each test.
    vi.resetModules();
    const mod = await import("./ServiceWorkerRegistration");
    return mod.ServiceWorkerRegistration;
};

describe("ServiceWorkerRegistration", () => {
    test("registers /sw.js in production when serviceWorker is supported", async () => {
        setNodeEnv("production");
        const Component = await importComponent();
        const { render } = await import("@testing-library/react");
        render(<Component />);
        // Effect runtime is asynchronous; wait one tick.
        await new Promise(r => setTimeout(r, 0));
        expect(navWithSW().serviceWorker?.register).toHaveBeenCalledTimes(1);
        expect(navWithSW().serviceWorker?.register).toHaveBeenCalledWith(
            "/sw.js",
            { scope: "/" },
        );
    });

    test("does NOT register in development", async () => {
        setNodeEnv("development");
        const Component = await importComponent();
        const { render } = await import("@testing-library/react");
        render(<Component />);
        await new Promise(r => setTimeout(r, 0));
        expect(
            navWithSW().serviceWorker?.register,
        ).not.toHaveBeenCalled();
    });

    test("no-ops without serviceWorker on navigator", async () => {
        setNodeEnv("production");
        // Tear down the per-test stub so `"serviceWorker" in navigator`
        // is false.
        delete navWithSW().serviceWorker;
        const Component = await importComponent();
        const { render } = await import("@testing-library/react");
        // Render must not throw.
        expect(() => render(<Component />)).not.toThrow();
    });
});
