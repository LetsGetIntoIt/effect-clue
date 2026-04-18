import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "Clue solver",
    description:
        "Track a game of Clue and watch the solver narrow the case file " +
        "down to one suspect, one weapon, and one room.",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
