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
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            reportsDirectory: "coverage",
        },
    },
});
