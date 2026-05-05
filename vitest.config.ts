import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "jsdom",
        globals: false,
        setupFiles: ["./vitest.setup.ts"],
        include: [
            "src/**/__tests__/**/*.{ts,tsx}",
            "src/**/?(*.)+(spec|test).{ts,tsx}",
            "scripts/**/?(*.)+(spec|test).mjs",
        ],
        clearMocks: true,
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            reportsDirectory: "coverage",
        },
    },
    resolve: {
        alias: {
            // The `server-only` package throws on import from any
            // non-server context to keep server modules out of the
            // browser bundle. In vitest (which runs in jsdom) the
            // import looks "client-side" even though we're testing
            // pure-Node code, so the throw is a false positive.
            // Redirect to a stub that no-ops.
            "server-only": path.resolve(
                __dirname,
                "src/test-utils/server-only-stub.ts",
            ),
        },
    },
});
