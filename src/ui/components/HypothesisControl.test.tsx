import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { HypothesisControl } from "./HypothesisControl";

vi.mock("next-intl", () => ({
    useTranslations: () => (key: string): string => key,
}));

const renderControl = (
    value: "Y" | "N" | undefined,
    onChange = vi.fn(),
) => {
    render(
        <HypothesisControl
            value={value}
            onChange={onChange}
            status={{ kind: "off" }}
        />,
    );
    return { onChange };
};

describe("HypothesisControl", () => {
    test("renders three radio buttons in a radiogroup", () => {
        renderControl(undefined);
        expect(screen.getByRole("radiogroup")).toBeInTheDocument();
        expect(screen.getAllByRole("radio")).toHaveLength(3);
    });

    test("the off button is checked when value is undefined", () => {
        renderControl(undefined);
        const radios = screen.getAllByRole("radio");
        expect(radios[0]).toHaveAttribute("aria-checked", "true");
        expect(radios[1]).toHaveAttribute("aria-checked", "false");
        expect(radios[2]).toHaveAttribute("aria-checked", "false");
    });

    test("clicking Y fires onChange('Y')", () => {
        const { onChange } = renderControl(undefined);
        const radios = screen.getAllByRole("radio");
        fireEvent.click(radios[1]!);
        expect(onChange).toHaveBeenCalledWith("Y");
    });

    test("clicking N fires onChange('N')", () => {
        const { onChange } = renderControl(undefined);
        const radios = screen.getAllByRole("radio");
        fireEvent.click(radios[2]!);
        expect(onChange).toHaveBeenCalledWith("N");
    });

    test("clicking off when Y is selected fires onChange(undefined)", () => {
        const { onChange } = renderControl("Y");
        const radios = screen.getAllByRole("radio");
        fireEvent.click(radios[0]!);
        expect(onChange).toHaveBeenCalledWith(undefined);
    });

    test("ArrowRight from off lands on Y and fires onChange('Y')", () => {
        const { onChange } = renderControl(undefined);
        const radios = screen.getAllByRole("radio");
        fireEvent.keyDown(radios[0]!, { key: "ArrowRight" });
        expect(onChange).toHaveBeenCalledWith("Y");
    });

    test("ArrowLeft from off wraps to N", () => {
        const { onChange } = renderControl(undefined);
        const radios = screen.getAllByRole("radio");
        fireEvent.keyDown(radios[0]!, { key: "ArrowLeft" });
        expect(onChange).toHaveBeenCalledWith("N");
    });

    test("Home jumps to off, End jumps to N", () => {
        const onChange = vi.fn();
        render(
            <HypothesisControl
                value="Y"
                onChange={onChange}
                status={{ kind: "off" }}
            />,
        );
        const radios = screen.getAllByRole("radio");
        fireEvent.keyDown(radios[1]!, { key: "Home" });
        expect(onChange).toHaveBeenLastCalledWith(undefined);
        fireEvent.keyDown(radios[1]!, { key: "End" });
        expect(onChange).toHaveBeenLastCalledWith("N");
    });
});
