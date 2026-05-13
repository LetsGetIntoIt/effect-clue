import { beforeEach, describe, expect, test } from "vitest";
import {
    getScroll,
    recordScroll,
    resetScrollMemory,
} from "./scrollMemory";

beforeEach(() => {
    resetScrollMemory();
});

describe("scrollMemory", () => {
    test("starts at 0 for every uiMode", () => {
        expect(getScroll("setup")).toBe(0);
        expect(getScroll("checklist")).toBe(0);
        expect(getScroll("suggest")).toBe(0);
    });

    test("recordScroll writes the value into the slot for that uiMode", () => {
        recordScroll("checklist", 420);
        expect(getScroll("checklist")).toBe(420);
    });

    test("slots are independent — writing one doesn't touch the others", () => {
        recordScroll("checklist", 420);
        expect(getScroll("setup")).toBe(0);
        expect(getScroll("suggest")).toBe(0);
    });

    test("resetScrollMemory zeroes every slot", () => {
        recordScroll("setup", 100);
        recordScroll("checklist", 200);
        recordScroll("suggest", 300);
        resetScrollMemory();
        expect(getScroll("setup")).toBe(0);
        expect(getScroll("checklist")).toBe(0);
        expect(getScroll("suggest")).toBe(0);
    });

    test("recordScroll overwrites the previous value", () => {
        recordScroll("suggest", 50);
        recordScroll("suggest", 75);
        expect(getScroll("suggest")).toBe(75);
    });
});
