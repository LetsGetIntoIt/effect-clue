import enMessages from "../../messages/en.json";

/**
 * Statically-bundled messages for the one locale we ship. This is a
 * static-export app (`output: "export"`) so there's no server to do a
 * locale lookup — we import the JSON directly and hand it to
 * `NextIntlClientProvider` at the root.
 *
 * Adding a locale later: import `fr.json`, switch on a query param or
 * navigator.language inside the provider, and keep the JSON files 1:1
 * with the key tree below. No other code changes.
 */
export const locale = "en";
export const messages = enMessages;
