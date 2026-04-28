import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "jsdom",
        globals: false,
        setupFiles: ["./vitest.setup.ts"],
        include: [
            "src/**/__tests__/**/*.{ts,tsx}",
            "src/**/?(*.)+(spec|test).{ts,tsx}",
        ],
        clearMocks: true,
        // Vitest's 5s per-test default isn't enough for the info-gain
        // Recommender tests on CI hardware: they enumerate ~324 candidate
        // triples × ~5 outcome variants × one runDeduce per outcome ≈ 1600
        // deducer runs per call. Locally they finish in ~3–4s; on a slower
        // GitHub runner they spike past 5s. A 30s ceiling still surfaces
        // hung tests without masking real regressions.
        testTimeout: 30_000,
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            reportsDirectory: "coverage",
        },
    },
});
