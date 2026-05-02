import type { Metadata } from "next";
import { Alfa_Slab_One, Crimson_Text } from "next/font/google";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { messages } from "../src/i18n/messages";
import { Providers } from "./Providers";
import "./globals.css";

/**
 * Display font for titles / section headings.
 *
 * Alfa Slab One is the closest free Google Font approximation to the
 * classic Cluedo / Clue box-art logo — a heavy slab serif with
 * slightly condensed proportions and square terminals, which reads
 * as both "detective novel" and "mid-century board game". Loaded
 * only at weight 400 because it ships as a single-weight display
 * face.
 */
const displayFont = Alfa_Slab_One({
    subsets: ["latin"],
    weight: "400",
    variable: "--font-display-loaded",
    display: "swap",
});

/**
 * Body font: a readable serif reminiscent of a classic detective
 * paperback. Crimson Text pairs well with Alfa Slab One — same
 * era, similar humanist proportions, much calmer at small sizes.
 */
const bodyFont = Crimson_Text({
    subsets: ["latin"],
    weight: ["400", "600", "700"],
    variable: "--font-body-loaded",
    display: "swap",
});

export const metadata: Metadata = {
    title: messages.app.title,
    description: messages.app.description,
    // M24: use the same magnifying-glass SVG that the PWA install
    // icon points at (`public/icons/icon.svg`) for the browser-tab
    // favicon. Chrome / Edge / Firefox accept SVG favicons natively;
    // Safari falls back gracefully to the default tab placeholder.
    // Keeping a single source means a future palette / artwork
    // change updates both surfaces in lockstep.
    icons: {
        icon: "/icons/icon.svg",
        apple: "/icons/icon-maskable.svg",
    },
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html
            lang="en"
            className={`${displayFont.variable} ${bodyFont.variable}`}
        >
            <body>
                <Providers>
                    <I18nProvider>{children}</I18nProvider>
                </Providers>
            </body>
        </html>
    );
}
