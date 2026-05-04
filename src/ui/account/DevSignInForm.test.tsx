import { describe, expect, test, beforeEach, vi } from "vitest";

const signInEmailMock = vi.fn();
vi.mock("./authClient", () => ({
    authClient: {
        signIn: {
            email: (input: unknown) => signInEmailMock(input),
        },
    },
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DevSignInForm } from "./DevSignInForm";

beforeEach(() => {
    signInEmailMock.mockReset();
    signInEmailMock.mockResolvedValue({ data: {}, error: null });
});

describe("DevSignInForm", () => {
    test("uses Better Auth signIn.email instead of posting directly", async () => {
        const onSignedIn = vi.fn();
        render(<DevSignInForm onSignedIn={onSignedIn} />);

        const form = screen.getByRole("button", {
            name: "Sign in (dev only)",
        }).closest("form");
        if (form === null) throw new Error("form not found");
        fireEvent.submit(form);

        await waitFor(() => {
            expect(signInEmailMock).toHaveBeenCalledWith({
                email: "alice@local",
                password: "dev-password",
            });
            expect(onSignedIn).toHaveBeenCalled();
        });
    });
});
