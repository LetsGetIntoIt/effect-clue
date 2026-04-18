"use client";

import { Clue } from "@/ui/Clue";

/**
 * The entire app is client-only — no server rendering, no API routes.
 * We mark the page as a client boundary and let <Clue /> own the state.
 */
export default function Page() {
    return <Clue />;
}
