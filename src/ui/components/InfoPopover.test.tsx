import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InfoPopover } from "./InfoPopover";

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));

describe("InfoPopover — content pointer-event hooks", () => {
    test("onContentPointerEnter fires when pointer enters the popover content", () => {
        const onEnter = vi.fn();
        render(
            <InfoPopover
                content="why"
                open
                onContentPointerEnter={onEnter}
            >
                <button type="button">trigger</button>
            </InfoPopover>,
        );
        const content = screen.getByRole("dialog");
        fireEvent.pointerEnter(content);
        expect(onEnter).toHaveBeenCalledTimes(1);
    });

    test("onContentPointerLeave fires when pointer leaves the popover content", () => {
        const onLeave = vi.fn();
        render(
            <InfoPopover
                content="why"
                open
                onContentPointerLeave={onLeave}
            >
                <button type="button">trigger</button>
            </InfoPopover>,
        );
        const content = screen.getByRole("dialog");
        fireEvent.pointerLeave(content);
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    test("absent handlers don't crash on pointer events", () => {
        render(
            <InfoPopover content="why" open>
                <button type="button">trigger</button>
            </InfoPopover>,
        );
        const content = screen.getByRole("dialog");
        expect(() => {
            fireEvent.pointerEnter(content);
            fireEvent.pointerLeave(content);
        }).not.toThrow();
    });
});

describe("InfoPopover — popoverZone marker", () => {
    test("renders data-popover-zone on the content when set", () => {
        render(
            <InfoPopover content="why" open popoverZone="checklist">
                <button type="button">trigger</button>
            </InfoPopover>,
        );
        const content = screen.getByRole("dialog");
        expect(content.getAttribute("data-popover-zone")).toBe("checklist");
    });

    test("omits data-popover-zone when not set", () => {
        render(
            <InfoPopover content="why" open>
                <button type="button">trigger</button>
            </InfoPopover>,
        );
        const content = screen.getByRole("dialog");
        expect(content.hasAttribute("data-popover-zone")).toBe(false);
    });
});

describe("InfoPopover — hover bridge", () => {
    // The `before:` pseudo-element extending toward the trigger lets the
    // cursor cross the gap from cell to popover without hitting cells in
    // between. jsdom can't pixel-test the bridge — we just confirm the
    // CSS classes that drive it are present on the Content element so
    // they get shipped to the browser.
    test("Content carries the bridge `before:` classes for every side", () => {
        render(
            <InfoPopover content="why" open>
                <button type="button">trigger</button>
            </InfoPopover>,
        );
        const content = screen.getByRole("dialog");
        const cls = content.className;
        expect(cls).toContain("before:absolute");
        expect(cls).toContain("before:content-['']");
        expect(cls).toContain("data-[side=top]:before:bottom-[-10px]");
        expect(cls).toContain("data-[side=bottom]:before:top-[-10px]");
        expect(cls).toContain("data-[side=left]:before:right-[-10px]");
        expect(cls).toContain("data-[side=right]:before:left-[-10px]");
    });
});
