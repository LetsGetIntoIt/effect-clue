const GOOGLE_CLIENT_ID_ENV = "GOOGLE_CLIENT_ID";
const GOOGLE_CLIENT_SECRET_ENV = "GOOGLE_CLIENT_SECRET";
const GOOGLE_PROMPT_SELECT_ACCOUNT = "select_account" as const;

const requiredEnv = (name: string): string => {
    const value = process.env[name];
    if (value === undefined || value.trim() === "") {
        throw new Error(
            `${name} is required for Better Auth configuration.`,
        );
    }
    return value;
};

export const assertGoogleOAuthEnvConfigured = (): void => {
    requiredEnv(GOOGLE_CLIENT_ID_ENV);
    requiredEnv(GOOGLE_CLIENT_SECRET_ENV);
};

export const googleProviderConfig = (): {
    readonly google: {
        readonly clientId: string;
        readonly clientSecret: string;
        readonly prompt: typeof GOOGLE_PROMPT_SELECT_ACCOUNT;
    };
} => ({
    google: {
        clientId: requiredEnv(GOOGLE_CLIENT_ID_ENV),
        clientSecret: requiredEnv(GOOGLE_CLIENT_SECRET_ENV),
        prompt: GOOGLE_PROMPT_SELECT_ACCOUNT,
    },
});
