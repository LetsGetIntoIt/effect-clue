"use client";

import { Suspense } from "react";
import { Clue } from "../../src/ui/Clue";

// Splash, tour, and install prompt all auto-fire from inside <Clue/>
// via `<StartupCoordinatorProvider>` so they don't stack on top of
// each other. This page is intentionally a thin shell.
export default function PlayPage() {
    return (
        <Suspense fallback={null}>
            <Clue />
        </Suspense>
    );
}
