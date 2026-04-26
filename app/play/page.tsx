"use client";

import { Clue } from "../../src/ui/Clue";
import { SplashModal } from "../../src/ui/components/SplashModal";
import { useSplashGate } from "../../src/ui/hooks/useSplashGate";

export default function PlayPage() {
    const { showSplash, dismiss } = useSplashGate();
    return (
        <>
            <Clue />
            <SplashModal open={showSplash} onDismiss={dismiss} />
        </>
    );
}
