import { describe, expect, jest, test } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { Player } from "../../logic/GameObjects";
import type { Option } from "./SuggestionPills";
import { MultiSelectList, NOBODY } from "./SuggestionPills";

const A = Player("Anisha");
const B = Player("Bob");
const C = Player("Cho");

const playerOpts: ReadonlyArray<Option<Player>> = [
    { value: A, label: "Anisha" },
    { value: B, label: "Bob" },
    { value: C, label: "Cho" },
];

// ---------------------------------------------------------------------------
// Regression guard: MultiSelectList previously ran its unmount-commit cleanup
// whenever `onCommit` changed identity (because the dep array was [onCommit]),
// which turned a non-memoized caller into an infinite render loop — the
// cleanup called `onCommit`, which dispatched a state update, which produced
// a new `onCommit`, which re-ran the cleanup. The fix puts `onCommit` behind
// a ref so the effect can use an empty dep array.
// ---------------------------------------------------------------------------

describe("MultiSelectList — onCommit identity stability", () => {
    test("does not loop when onCommit is a new function every render", () => {
        // Harness whose onCommit is not memoized. If `onCommit` is called
        // during the list's lifetime, it bumps `tick`, which re-renders the
        // harness with a fresh onCommit — the exact shape that tripped the
        // bug. Hard render-count ceiling makes the test fail fast rather
        // than wait for React's "Maximum update depth" guardrail (which
        // takes several seconds of spinning).
        const MAX_RENDERS = 10;
        let renderCount = 0;
        function Harness({
            onCommitSpy,
        }: {
            readonly onCommitSpy: jest.Mock;
        }) {
            renderCount += 1;
            if (renderCount > MAX_RENDERS) {
                throw new Error(
                    `Harness re-rendered more than ${MAX_RENDERS} times — infinite loop`,
                );
            }
            const [tick, setTick] = useState(0);
            // Force one re-render after mount to change `onCommit`'s
            // identity — simulates the parent re-rendering for any reason
            // while the popover is open.
            useEffect(() => {
                setTick(t => t + 1);
            }, []);
            const onCommit = (
                value: ReadonlyArray<Player> | typeof NOBODY,
                opts?: { advance: boolean },
            ) => {
                onCommitSpy(value, opts);
                setTick(t => t + 1);
            };
            return (
                <div data-testid="tick" data-tick={tick}>
                    <MultiSelectList
                        options={playerOpts}
                        selected={[]}
                        nobodyChosen={false}
                        nobodyLabel="Nobody"
                        commitHint="Press Enter"
                        onCommit={onCommit}
                    />
                </div>
            );
        }

        const onCommitSpy = jest.fn();
        expect(() => render(<Harness onCommitSpy={onCommitSpy} />)).not.toThrow();
        // The list lives on; onCommit should never have fired during its
        // lifetime (the cleanup only runs on unmount now).
        expect(onCommitSpy).not.toHaveBeenCalled();
        expect(renderCount).toBeLessThanOrEqual(MAX_RENDERS);
    });

    test("commits toggled state exactly once on unmount", async () => {
        const user = userEvent.setup();
        const onCommit = jest.fn();
        const { unmount } = render(
            <MultiSelectList
                options={playerOpts}
                selected={[]}
                nobodyChosen={false}
                nobodyLabel="Nobody"
                commitHint="Press Enter"
                onCommit={onCommit}
            />,
        );
        // Toggle Anisha and Bob via click — commit-on-close should capture
        // them without any explicit Enter.
        await user.click(screen.getByRole("option", { name: /Anisha/ }));
        await user.click(screen.getByRole("option", { name: /Bob/ }));
        expect(onCommit).not.toHaveBeenCalled();
        unmount();
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith([A, B], { advance: false });
    });

    test("does not commit on onCommit identity change during lifetime", () => {
        // Variation on the first test that also asserts the spy is never
        // called, locking in "cleanup runs on unmount only".
        function Harness() {
            const [tick, setTick] = useState(0);
            useEffect(() => {
                // Two extra re-renders after mount.
                setTick(1);
                setTick(2);
            }, []);
            const onCommit = (value: ReadonlyArray<Player> | typeof NOBODY) => {
                spy(value);
            };
            return (
                <div data-tick={tick}>
                    <MultiSelectList
                        options={playerOpts}
                        selected={[]}
                        nobodyChosen={false}
                        nobodyLabel="Nobody"
                        commitHint="Press Enter"
                        onCommit={onCommit}
                    />
                </div>
            );
        }
        const spy = jest.fn();
        render(<Harness />);
        expect(spy).not.toHaveBeenCalled();
    });

    test("Enter commits current toggled set and advances", async () => {
        const user = userEvent.setup();
        const onCommit = jest.fn();
        render(
            <MultiSelectList
                options={playerOpts}
                selected={[]}
                nobodyChosen={false}
                nobodyLabel="Nobody"
                commitHint="Press Enter"
                onCommit={onCommit}
            />,
        );
        await user.click(screen.getByRole("option", { name: /Anisha/ }));
        // Listbox owns keyboard input; focus it first.
        screen.getByRole("listbox").focus();
        await user.keyboard("{Enter}");
        expect(onCommit).toHaveBeenCalledTimes(1);
        // `advance: true` is the default when opts are omitted.
        expect(onCommit).toHaveBeenCalledWith([A]);
    });

    test("selecting Nobody commits NOBODY and advances", async () => {
        const user = userEvent.setup();
        const onCommit = jest.fn();
        render(
            <MultiSelectList
                options={playerOpts}
                selected={[]}
                nobodyChosen={false}
                nobodyLabel="Nobody passed"
                commitHint="Press Enter"
                onCommit={onCommit}
            />,
        );
        await user.click(screen.getByRole("option", { name: /Nobody passed/ }));
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith(NOBODY);
    });
});
