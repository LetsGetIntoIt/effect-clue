import { afterEach, describe, expect, test, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
});

const importAuthWithEnv = async (
    env: Record<string, string | undefined>,
) => {
    vi.resetModules();
    let capturedConfig: unknown;
    vi.doMock("better-auth", () => ({
        betterAuth: (config: unknown) => {
            capturedConfig = config;
            return { config };
        },
    }));
    vi.doMock("better-auth/plugins", () => ({
        anonymous: () => "anonymous-plugin",
    }));
    vi.doMock("pg", () => ({
        Pool: class Pool {
            readonly options: unknown;
            constructor(options: unknown) {
                this.options = options;
            }
        },
    }));
    process.env = { ...ORIGINAL_ENV, ...env };
    await import("./auth");
    return capturedConfig as {
        readonly baseURL: string;
        readonly socialProviders: {
            readonly google: {
                readonly clientId: string;
                readonly clientSecret: string;
                readonly prompt: string;
            };
        };
        readonly logger: { readonly level: string };
        readonly plugins: ReadonlyArray<string>;
    };
};

describe("better-auth config", () => {
    test("configures Google OAuth unconditionally with select_account prompt", async () => {
        const config = await importAuthWithEnv({
            BETTER_AUTH_URL: "https://example.test",
            GOOGLE_CLIENT_ID: "google-id",
            GOOGLE_CLIENT_SECRET: "google-secret",
        });

        expect(config.baseURL).toBe("https://example.test");
        expect(config.socialProviders.google).toEqual({
            clientId: "google-id",
            clientSecret: "google-secret",
            prompt: "select_account",
        });
        expect(config.plugins).toEqual(["anonymous-plugin"]);
    });

    test("fails fast when Google client id is missing", async () => {
        await expect(
            importAuthWithEnv({
                BETTER_AUTH_URL: "https://example.test",
                GOOGLE_CLIENT_ID: undefined,
                GOOGLE_CLIENT_SECRET: "google-secret",
            }),
        ).rejects.toThrow("GOOGLE_CLIENT_ID is required");
    });

    test("fails fast when Google client secret is missing", async () => {
        await expect(
            importAuthWithEnv({
                BETTER_AUTH_URL: "https://example.test",
                GOOGLE_CLIENT_ID: "google-id",
                GOOGLE_CLIENT_SECRET: undefined,
            }),
        ).rejects.toThrow("GOOGLE_CLIENT_SECRET is required");
    });

    test("enables Better Auth debug logs with AUTH_DEBUG=1", async () => {
        const config = await importAuthWithEnv({
            AUTH_DEBUG: "1",
            BETTER_AUTH_URL: "https://example.test",
            GOOGLE_CLIENT_ID: "google-id",
            GOOGLE_CLIENT_SECRET: "google-secret",
        });

        expect(config.logger.level).toBe("debug");
    });

    test("fails fast when BETTER_AUTH_URL is missing outside development", async () => {
        await expect(
            importAuthWithEnv({
                NODE_ENV: "production",
                BETTER_AUTH_URL: undefined,
                GOOGLE_CLIENT_ID: "google-id",
                GOOGLE_CLIENT_SECRET: "google-secret",
            }),
        ).rejects.toThrow("BETTER_AUTH_URL is required");
    });
});
