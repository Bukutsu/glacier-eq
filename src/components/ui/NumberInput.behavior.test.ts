import { beforeEach, describe, expect, it, vi } from "vitest";
import { NumberInput } from "./NumberInput";
import { useToastStore } from "@/stores/toastStore";

let draft: string | null = null;
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: () => [
    draft,
    (next: string | null) => {
      draft = next;
    },
  ],
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function setup(
  onStep?: (direction: 1 | -1, largeStep: boolean, value: number) => void,
) {
  const changes: number[] = [];
  let value = 2.5;
  const render = () => {
    const element = NumberInput({
      value,
      min: -12,
      max: 12,
      step: 0.1,
      precision: 2,
      onStep,
      onChange: (next) => {
        value = next;
        changes.push(next);
      },
    });
    return element.props.children[1].props;
  };
  const type = (text: string) => render().onChange({ target: { value: text } });
  const key = (name: string) =>
    render().onKeyDown({ key: name, preventDefault: () => {} });
  return { changes, render, type, key, value: () => value };
}

beforeEach(() => {
  draft = null;
  for (const toast of useToastStore.getState().toasts)
    useToastStore.getState().removeToast(toast.id);
});

describe("NumberInput draft editing", () => {
  it("does not apply a valid prefix of an invalid entry", () => {
    const input = setup();
    input.type("5");
    input.type("5x");
    expect(input.changes).toEqual([]);
    input.render().onBlur();
    expect(input.value()).toBe(2.5);
    expect(
      useToastStore.getState().toasts.some((toast) => toast.type === "error"),
    ).toBe(true);
  });

  it("commits a valid decimal on blur and clamps out-of-range input", () => {
    const input = setup();
    input.type("-3,25");
    expect(input.changes).toEqual([]);
    input.render().onBlur();
    expect(input.value()).toBe(-3.25);
    input.type("100");
    input.render().onBlur();
    expect(input.value()).toBe(12);
  });

  it("steps from a valid draft rather than the previous committed value", () => {
    const input = setup();
    input.type("5");
    input.key("ArrowUp");
    expect(input.value()).toBe(5.1);
    expect(draft).toBeNull();
  });

  it("does not step or discard an invalid draft", () => {
    const input = setup();
    input.type("5x");
    input.key("ArrowUp");
    expect(input.value()).toBe(2.5);
    expect(draft).toBe("5x");
    expect(useToastStore.getState().toasts[0]?.type).toBe("error");
  });

  it("passes the draft value to custom frequency stepping", () => {
    const onStep = vi.fn();
    const input = setup(onStep);
    input.type("5");
    input.key("PageDown");
    expect(onStep).toHaveBeenCalledExactlyOnceWith(-1, true, 5);
  });
});
