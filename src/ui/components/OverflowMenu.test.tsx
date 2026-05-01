/**
 * Pins the `forceOpen` behavior added so the onboarding tour's
 * "Everything else lives here" step can pin the menu open while
 * pointing at it.
 */
import { describe, expect, test, vi } from "vitest";
import { forwardRef, createElement } from "react";
import type { ReactNode } from "react";

vi.mock("next-intl", () => {
    const t = (key: string): string => key;
    return { useTranslations: () => t };
});

vi.mock("motion/react", () => {
    const motion = new Proxy(
        {},
        {
            get: (_t, tag: string) =>
                forwardRef(
                    (
                        props: Record<string, unknown>,
                        ref: React.Ref<HTMLElement>,
                    ) => {
                        const {
                            initial: _i,
                            animate: _a,
                            exit: _e,
                            transition: _tr,
                            variants: _v,
                            ...rest
                        } = props;
                        return createElement(tag, { ...rest, ref });
                    },
                ),
        },
    );
    return {
        motion,
        AnimatePresence: ({ children }: { children: ReactNode }) => children,
        useReducedMotion: () => false,
    };
});

import { fireEvent, render, screen } from "@testing-library/react";
import { OverflowMenu } from "./OverflowMenu";

const items = [
    {
        label: "First action",
        onClick: () => {},
    },
    {
        label: "Second action",
        onClick: () => {},
    },
];

describe("OverflowMenu — forceOpen", () => {
    test("without forceOpen, menu opens / closes via the trigger", () => {
        render(
            <OverflowMenu
                triggerClassName="trigger"
                triggerLabel="more"
                side="bottom"
                align="end"
                items={items}
            />,
        );
        // Closed initially → no menu items in the DOM.
        expect(screen.queryByText("First action")).toBeNull();
        // Click the trigger → menu opens, items render.
        fireEvent.click(screen.getByRole("button", { name: "more" }));
        expect(screen.getByText("First action")).toBeInTheDocument();
        expect(screen.getByText("Second action")).toBeInTheDocument();
    });

    test("forceOpen=true mounts the menu open without a trigger click", () => {
        render(
            <OverflowMenu
                triggerClassName="trigger"
                triggerLabel="more"
                side="bottom"
                align="end"
                items={items}
                forceOpen
            />,
        );
        expect(screen.getByText("First action")).toBeInTheDocument();
        expect(screen.getByText("Second action")).toBeInTheDocument();
    });

    test("forceOpen=false behaves like no forceOpen — closed by default", () => {
        render(
            <OverflowMenu
                triggerClassName="trigger"
                triggerLabel="more"
                side="bottom"
                align="end"
                items={items}
                forceOpen={false}
            />,
        );
        expect(screen.queryByText("First action")).toBeNull();
    });

    test("dividers between items render as role='separator'", () => {
        const itemsWithDivider = [
            items[0]!,
            { type: "divider" as const },
            items[1]!,
        ];
        render(
            <OverflowMenu
                triggerClassName="trigger"
                triggerLabel="more"
                side="bottom"
                align="end"
                items={itemsWithDivider}
                forceOpen
            />,
        );
        expect(screen.getByRole("separator")).toBeInTheDocument();
    });
});
