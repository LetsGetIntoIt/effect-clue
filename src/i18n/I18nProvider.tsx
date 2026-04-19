"use client";

import { NextIntlClientProvider } from "next-intl";
import { locale, messages } from "./messages";

/**
 * Client-side wrapper that boots next-intl with the single bundled
 * locale. Lives in its own module so `app/layout.tsx` can stay a
 * Server Component and import just this boundary.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
    return (
        <NextIntlClientProvider
            locale={locale}
            messages={messages}
            timeZone="UTC"
        >
            {children}
        </NextIntlClientProvider>
    );
}
