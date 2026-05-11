/* eslint-disable i18next/no-literal-string -- whole file is dev-only;
   tree-shaken from production. Local-only copy doesn't go through i18n. */
/**
 * Local-development-only sign-in form. Uses Better Auth's client
 * `signIn.email` action with pre-seeded test credentials so dev
 * machines can run the full authenticated flow without leaving
 * localhost.
 *
 * Defense-in-depth layer 4: the parent (`AccountModal`) wraps
 * this component in `process.env.NODE_ENV === "development" &&
 * <DevSignInForm />`. Next inlines `process.env.NODE_ENV` to a
 * literal `"production"` in production builds, so the conditional
 * collapses to `false && ...` and the entire subtree
 * (including this file's import + JSX) is dead-code-eliminated.
 *
 * The deliberate, distinct identifier `DevSignInForm` is what the
 * `pnpm assert:no-dev-auth` CI grep watches for in the production
 * bundle.
 */
"use client";

import { useState } from "react";
import { authClient } from "./authClient";

interface DevSignInFormProps {
    /** Called after a successful sign-in so the parent can refresh
     * the session query and dismiss the modal. */
    readonly onSignedIn: () => void;
}

export function DevSignInForm({ onSignedIn }: DevSignInFormProps) {
    const [email, setEmail] = useState("alice@local");
    const [password, setPassword] = useState("dev-password");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            const result = await authClient.signIn.email({
                email,
                password,
            });
            if (result.error !== null) {
                setError(`Sign-in failed (${result.error.status})`);
                return;
            }
            onSignedIn();
        } catch (err) {
            setError(`Network error: ${String(err)}`);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form
            onSubmit={onSubmit}
            className="mt-3 flex flex-col gap-2 rounded-[var(--radius)] border border-dashed border-border bg-row-alt/40 p-3 text-[1rem]"
        >
            <div className="font-semibold uppercase tracking-[0.05em] text-muted">
                Dev sign-in
            </div>
            <p className="m-0 text-muted">
                Local-only. Stripped from production builds.
            </p>
            <label className="flex flex-col gap-0.5">
                <span className="text-muted">Email</span>
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    className="rounded border border-border bg-white px-2 py-1 text-[1rem]"
                />
            </label>
            <label className="flex flex-col gap-0.5">
                <span className="text-muted">Password</span>
                <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="off"
                    className="tap-target-compact text-tap-compact rounded border border-border bg-white"
                />
            </label>
            {error !== null ? (
                <div className="text-danger">{error}</div>
            ) : null}
            <button
                type="submit"
                disabled={submitting}
                className="tap-target-compact text-tap-compact cursor-pointer rounded-[var(--radius)] border border-border bg-white hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
                {submitting ? "Signing in…" : "Sign in (dev only)"}
            </button>
        </form>
    );
}
