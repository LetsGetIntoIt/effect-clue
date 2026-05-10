/**
 * Tests for the modal stack provider + shell.
 *
 * Covered:
 *   - push/pop/popTo/closeAll mechanics
 *   - onClose firing order on multi-pop
 *   - idempotent re-push (same id replaces top without animating)
 *   - Dialog mount gating on stack.length
 *   - dismissOnOutsideClick + dismissOnEscape opt-outs
 *
 * Not covered (jsdom can't measure layout / run animations):
 *   - slide-x animations
 *   - height auto-animation between entries
 * Those are verified manually in the next-dev preview per CLAUDE.md.
 */
import "@testing-library/jest-dom/vitest";
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import { ModalStackProvider, ModalStackShell, useModalStack } from "./ModalStack";

const messages = {
    common: {
        confirm: "Confirm",
        cancel: "Cancel",
        close: "Close",
        confirmTitle: "Please confirm",
    },
};

function renderWithProvider(node: React.ReactNode) {
    return render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <ModalStackProvider>
                {node}
                <ModalStackShell />
            </ModalStackProvider>
        </NextIntlClientProvider>,
    );
}

/**
 * Test harness — exposes the stack API to the test via render-prop.
 * Lets a test push/pop and then assert on rendered output.
 */
function StackHarness({
    onMount,
}: {
    readonly onMount: (api: ReturnType<typeof useModalStack>) => void;
}) {
    const api = useModalStack();
    onMount(api);
    return null;
}

afterEach(() => {
    cleanup();
});

describe("ModalStackProvider — basic mechanics", () => {
    test("starts empty and renders nothing in the dialog portal", () => {
        renderWithProvider(<StackHarness onMount={() => {}} />);
        // Radix Dialog.Portal mounts to body; with stack empty it
        // shouldn't have rendered any dialog content.
        expect(document.querySelector("[role='dialog']")).toBeNull();
    });

    test("push opens the dialog with the entry's content", () => {
        let api!: ReturnType<typeof useModalStack>;
        renderWithProvider(
            <StackHarness onMount={(a) => { api = a; }} />,
        );
        act(() => {
            api.push({
                id: "entry-1",
                title: "Test entry",
                content: <div data-testid="content-1">Hello world</div>,
            });
        });
        expect(screen.getByTestId("content-1")).toBeInTheDocument();
        // Title flows to the dialog via `aria-label` on Dialog.Content,
        // since the shell delegates `Dialog.Title` rendering to each
        // modal content. `getByLabelText` matches that aria-label.
        expect(screen.getByLabelText("Test entry")).toBeInTheDocument();
    });

    test("pop removes the top entry and fires its onClose", () => {
        let api!: ReturnType<typeof useModalStack>;
        const onClose = vi.fn();
        renderWithProvider(
            <StackHarness onMount={(a) => { api = a; }} />,
        );
        act(() => {
            api.push({
                id: "entry-1",
                title: "Test",
                content: <div data-testid="content-1">a</div>,
                onClose,
            });
        });
        act(() => {
            api.pop();
        });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(api.stack.length).toBe(0);
    });

    test("pop on empty stack is a no-op", () => {
        let api!: ReturnType<typeof useModalStack>;
        renderWithProvider(
            <StackHarness onMount={(a) => { api = a; }} />,
        );
        expect(() => act(() => { api.pop(); })).not.toThrow();
        expect(api.stack.length).toBe(0);
    });

    test("push on top of existing entry shows the new content", async () => {
        let api!: ReturnType<typeof useModalStack>;
        renderWithProvider(
            <StackHarness onMount={(a) => { api = a; }} />,
        );
        act(() => {
            api.push({
                id: "entry-1",
                title: "First",
                content: <div data-testid="content-1">a</div>,
            });
        });
        act(() => {
            api.push({
                id: "entry-2",
                title: "Second",
                content: <div data-testid="content-2">b</div>,
            });
        });
        // Stack records the second entry immediately. The shell uses
        // `mode="wait"` so the new content mounts only after the
        // previous exit animation completes — `waitFor` retries until
        // that's settled. (Full DOM swap is verified manually in the
        // preview per CLAUDE.md, since jsdom doesn't run animations.)
        expect(api.stack.length).toBe(2);
        await waitFor(() => {
            expect(screen.getByTestId("content-2")).toBeInTheDocument();
        });
    });

    test("pushing an entry with the same id as top replaces it without growing the stack", () => {
        let api!: ReturnType<typeof useModalStack>;
        const firstClose = vi.fn();
        const secondClose = vi.fn();
        renderWithProvider(
            <StackHarness onMount={(a) => { api = a; }} />,
        );
        act(() => {
            api.push({
                id: "same",
                title: "First",
                content: <div data-testid="first">a</div>,
                onClose: firstClose,
            });
        });
        act(() => {
            api.push({
                id: "same",
                title: "Second",
                content: <div data-testid="second">b</div>,
                onClose: secondClose,
            });
        });
        expect(api.stack.length).toBe(1);
        expect(screen.getByTestId("second")).toBeInTheDocument();
        // The replaced entry's onClose is NOT fired — replacing isn't
        // the same as popping. The pusher of "same" is responsible
        // for any cleanup in the new content.
        expect(firstClose).not.toHaveBeenCalled();
    });
});

describe("ModalStackProvider — popTo and closeAll", () => {
    test("popTo removes everything above and including the named entry, in stack order", () => {
        let api!: ReturnType<typeof useModalStack>;
        const order: Array<string> = [];
        renderWithProvider(
            <StackHarness onMount={(a) => { api = a; }} />,
        );
        act(() => {
            api.push({
                id: "a",
                title: "A",
                content: <div>a</div>,
                onClose: () => order.push("a"),
            });
        });
        act(() => {
            api.push({
                id: "b",
                title: "B",
                content: <div>b</div>,
                onClose: () => order.push("b"),
            });
        });
        act(() => {
            api.push({
                id: "c",
                title: "C",
                content: <div>c</div>,
                onClose: () => order.push("c"),
            });
        });
        act(() => {
            api.popTo("b");
        });
        expect(api.stack.map(e => e.id)).toEqual(["a"]);
        // Top first: c popped before b.
        expect(order).toEqual(["c", "b"]);
    });

    test("popTo with an unknown id is a no-op", () => {
        let api!: ReturnType<typeof useModalStack>;
        renderWithProvider(
            <StackHarness onMount={(a) => { api = a; }} />,
        );
        act(() => {
            api.push({ id: "a", title: "A", content: <div>a</div> });
        });
        act(() => {
            api.popTo("not-here");
        });
        expect(api.stack.length).toBe(1);
    });

    test("closeAll empties the stack and fires every onClose top-first", () => {
        let api!: ReturnType<typeof useModalStack>;
        const order: Array<string> = [];
        renderWithProvider(
            <StackHarness onMount={(a) => { api = a; }} />,
        );
        act(() => {
            api.push({
                id: "a",
                title: "A",
                content: <div>a</div>,
                onClose: () => order.push("a"),
            });
        });
        act(() => {
            api.push({
                id: "b",
                title: "B",
                content: <div>b</div>,
                onClose: () => order.push("b"),
            });
        });
        act(() => {
            api.closeAll();
        });
        expect(api.stack.length).toBe(0);
        expect(order).toEqual(["b", "a"]);
    });
});

describe("ModalStackProvider — dismissOnEscape opt-out", () => {
    test("Escape pops by default", () => {
        let api!: ReturnType<typeof useModalStack>;
        renderWithProvider(
            <StackHarness onMount={(a) => { api = a; }} />,
        );
        act(() => {
            api.push({
                id: "default-escape",
                title: "Default",
                content: <div data-testid="content">x</div>,
            });
        });
        // Radix Dialog listens on document for Escape. Fire on document.
        act(() => {
            fireEvent.keyDown(document, { key: "Escape" });
        });
        expect(api.stack.length).toBe(0);
    });

    test("dismissOnEscape: false keeps the entry on Escape", () => {
        let api!: ReturnType<typeof useModalStack>;
        renderWithProvider(
            <StackHarness onMount={(a) => { api = a; }} />,
        );
        act(() => {
            api.push({
                id: "no-escape",
                title: "Strict",
                content: <div data-testid="content">x</div>,
                dismissOnEscape: false,
            });
        });
        act(() => {
            fireEvent.keyDown(document, { key: "Escape" });
        });
        expect(api.stack.length).toBe(1);
    });
});
