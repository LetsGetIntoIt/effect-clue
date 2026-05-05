import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InfoPopover } from "./InfoPopover";

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));

describe("InfoPopover — content pointer-event hooks", () => {
    test("onContentPointerEnter fires for mouse pointer entering the popover content", () => {
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
        fireEvent.pointerEnter(content, { pointerType: "mouse" });
        expect(onEnter).toHaveBeenCalledTimes(1);
    });

    test("onContentPointerLeave fires for mouse pointer leaving the popover content", () => {
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
        fireEvent.pointerLeave(content, { pointerType: "mouse" });
        expect(onLeave).toHaveBeenCalledTimes(1);
    });

    // The hover-intent contract is mouse-only. On touch, the W3C spec
    // fires a synthetic `pointerleave` after `pointerup` because the
    // touch pointer ceases to exist. Forwarding that to the parent's
    // exit timer would close the popover the user just tapped a
    // control inside (regression covered: tapping Y/N inside a
    // checklist popover on mobile dismissed it ~900 ms later).
    test("does NOT forward touch pointer enter/leave to the parent", () => {
        const onEnter = vi.fn();
        const onLeave = vi.fn();
        render(
            <InfoPopover
                content="why"
                open
                onContentPointerEnter={onEnter}
                onContentPointerLeave={onLeave}
            >
                <button type="button">trigger</button>
            </InfoPopover>,
        );
        const content = screen.getByRole("dialog");
        fireEvent.pointerEnter(content, { pointerType: "touch" });
        fireEvent.pointerLeave(content, { pointerType: "touch" });
        expect(onEnter).not.toHaveBeenCalled();
        expect(onLeave).not.toHaveBeenCalled();
    });

    test("does NOT forward pen pointer enter/leave to the parent", () => {
        const onEnter = vi.fn();
        const onLeave = vi.fn();
        render(
            <InfoPopover
                content="why"
                open
                onContentPointerEnter={onEnter}
                onContentPointerLeave={onLeave}
            >
                <button type="button">trigger</button>
            </InfoPopover>,
        );
        const content = screen.getByRole("dialog");
        fireEvent.pointerEnter(content, { pointerType: "pen" });
        fireEvent.pointerLeave(content, { pointerType: "pen" });
        expect(onEnter).not.toHaveBeenCalled();
        expect(onLeave).not.toHaveBeenCalled();
    });

    test("absent handlers don't crash on pointer events", () => {
        render(
            <InfoPopover content="why" open>
                <button type="button">trigger</button>
            </InfoPopover>,
        );
        const content = screen.getByRole("dialog");
        expect(() => {
            fireEvent.pointerEnter(content, { pointerType: "mouse" });
            fireEvent.pointerLeave(content, { pointerType: "mouse" });
            fireEvent.pointerEnter(content, { pointerType: "touch" });
            fireEvent.pointerLeave(content, { pointerType: "touch" });
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
