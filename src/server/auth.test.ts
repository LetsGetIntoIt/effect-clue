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
        oAuthProxy: (opts?: { readonly productionURL?: string }) => ({
            id: "oauth-proxy-plugin",
            opts: opts ?? {},
        }),
    }));
    vi.doMock("pg", () => ({
        Pool: class Pool {
            readonly options: unknown;
            constructor(options: unknown) {
                this.options = options;
            }
        },
    }));
    process.env = {
        ...ORIGINAL_ENV,
        DATABASE_URL: "postgres://example.test/app",
        ...env,
    };
    await import("./auth");
    return capturedConfig as {
        readonly baseURL:
            | string
            | {
                  readonly allowedHosts: ReadonlyArray<string>;
                  readonly protocol: string;
              };
        readonly trustedOrigins: ReadonlyArray<string>;
        readonly socialProviders: {
            readonly google: {
                readonly clientId: string;
                readonly clientSecret: string;
                readonly prompt: string;
            };
        };
        readonly logger: { readonly level: string };
        readonly plugins: ReadonlyArray<
            | string
            | {
                  readonly id: string;
                  readonly opts: { readonly productionURL?: string };
              }
        >;
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
        expect(config.socialProviders?.google).toEqual({
            clientId: "google-id",
            clientSecret: "google-secret",
            prompt: "select_account",
        });
        expect(config.plugins).toEqual([
            "anonymous-plugin",
            { id: "oauth-proxy-plugin", opts: {} },
        ]);
    });

    test("oAuthProxy plugin reads productionURL from BETTER_AUTH_PRODUCTION_URL", async () => {
        const config = await importAuthWithEnv({
            BETTER_AUTH_URL: "https://winclue-pr-42.vercel.app",
            BETTER_AUTH_PRODUCTION_URL: "https://winclue.vercel.app",
            GOOGLE_CLIENT_ID: "google-id",
            GOOGLE_CLIENT_SECRET: "google-secret",
        });

        expect(config.plugins).toEqual([
            "anonymous-plugin",
            {
                id: "oauth-proxy-plugin",
                opts: { productionURL: "https://winclue.vercel.app" },
            },
        ]);
    });

    test("trustedOrigins includes production aliases, preview wildcard, and localhost", async () => {
        const config = await importAuthWithEnv({
            BETTER_AUTH_URL: "https://example.test",
            GOOGLE_CLIENT_ID: "google-id",
            GOOGLE_CLIENT_SECRET: "google-secret",
        });

        expect(config.trustedOrigins).toEqual([
            "https://winclue.vercel.app",
            "https://effect-clue.vercel.app",
            "https://effect-clue-*-lets-get-into-it.vercel.app",
            "http://localhost:*",
        ]);
    });

    test("fails fast when Google client id is missing", async () => {
        await expect(
            importAuthWithEnv({
                NODE_ENV: "production",
                BETTER_AUTH_URL: "https://example.test",
                GOOGLE_CLIENT_ID: undefined,
                GOOGLE_CLIENT_SECRET: "google-secret",
            }),
        ).rejects.toThrow("GOOGLE_CLIENT_ID is required");
    });

    test("fails fast when Google client secret is missing", async () => {
        await expect(
            importAuthWithEnv({
                NODE_ENV: "production",
                BETTER_AUTH_URL: "https://example.test",
                GOOGLE_CLIENT_ID: "google-id",
                GOOGLE_CLIENT_SECRET: undefined,
            }),
        ).rejects.toThrow("GOOGLE_CLIENT_SECRET is required");
    });

    test("uses request-derived local auth URL when Google credentials are configured", async () => {
        const config = await importAuthWithEnv({
            NODE_ENV: "development",
            BETTER_AUTH_URL: undefined,
            GOOGLE_CLIENT_ID: "google-id",
            GOOGLE_CLIENT_SECRET: "google-secret",
        });

        expect(config.baseURL).toEqual({
            allowedHosts: ["localhost:*", "127.*:*", "[::1]:*"],
            protocol: "http",
        });
        expect(config.socialProviders.google).toEqual({
            clientId: "google-id",
            clientSecret: "google-secret",
            prompt: "select_account",
        });
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
