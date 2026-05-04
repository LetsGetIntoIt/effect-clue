import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = process.cwd();
const AUTH_UI_FILES = [
    "src/ui/account/AccountModal.tsx",
    "src/ui/account/DevSignInForm.tsx",
    "src/ui/share/ShareCreateModal.tsx",
] as const;

describe("auth UI Better Auth compliance", () => {
    test("does not call auth endpoints or browser redirects directly", () => {
        const source = AUTH_UI_FILES.map((file) =>
            readFileSync(join(ROOT, file), "utf8"),
        ).join("\n");

        expect(source).not.toContain("/api/auth/sign-in/social");
        expect(source).not.toContain("/api/auth/sign-out");
        expect(source).not.toContain("/api/auth/sign-in/email");
        expect(source).not.toContain("window.location.href");
    });
});
