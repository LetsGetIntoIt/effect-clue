import { afterEach, describe, expect, test } from "vitest";
import {
    assertGoogleOAuthEnvConfigured,
    googleProviderConfig,
} from "./authEnv";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
});

describe("Google OAuth environment", () => {
    test("builds the Better Auth Google provider when both credentials are set", () => {
        process.env["GOOGLE_CLIENT_ID"] = "google-client-id";
        process.env["GOOGLE_CLIENT_SECRET"] = "google-client-secret";

        expect(googleProviderConfig()).toEqual({
            google: {
                clientId: "google-client-id",
                clientSecret: "google-client-secret",
                prompt: "select_account",
            },
        });
    });

    test("fails when Google client id is blank", () => {
        process.env["GOOGLE_CLIENT_ID"] = "";
        process.env["GOOGLE_CLIENT_SECRET"] = "google-client-secret";

        expect(assertGoogleOAuthEnvConfigured).toThrow(
            "GOOGLE_CLIENT_ID is required",
        );
    });

    test("fails when Google client secret is missing", () => {
        process.env["GOOGLE_CLIENT_ID"] = "google-client-id";
        delete process.env["GOOGLE_CLIENT_SECRET"];

        expect(assertGoogleOAuthEnvConfigured).toThrow(
            "GOOGLE_CLIENT_SECRET is required",
        );
    });
});
