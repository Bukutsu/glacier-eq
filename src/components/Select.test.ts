import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Select, type SelectProps } from "./Select";

const capture = vi.hoisted(() => ({
  root: null as unknown as ComponentProps<typeof BaseSelect.Root>,
  container: null as unknown as ComponentProps<typeof BaseSelect.Portal>["container"],
  positionMethod: null as string | null,
  triggerRef: null as unknown as (node: HTMLButtonElement | null) => void,
}));

vi.mock("@base-ui/react/select", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@base-ui/react/select")>();
  return { ...actual, Select: { ...actual.Select,
    Root: (props: ComponentProps<typeof BaseSelect.Root>) => {
      capture.root = props;
      return createElement(actual.Select.Root, props);
    },
    Trigger: (props: ComponentProps<typeof BaseSelect.Trigger>) => {
      capture.triggerRef = props.ref as typeof capture.triggerRef;
      return createElement(actual.Select.Trigger, props);
    },
    Portal: (props: ComponentProps<typeof BaseSelect.Portal>) => {
      capture.container = props.container;
      capture.positionMethod = (props.children as ReactElement<{ positionMethod: string }>).props.positionMethod;
      return createElement(actual.Select.Portal, props);
    },
  }};
});

const options = [
  { value: 0, label: "Zero" },
  { value: 1, label: "One" },
  { value: 2, label: "Two", disabled: true },
];
function render<T extends string | number>(props: SelectProps<T>) {
  return renderToStaticMarkup(createElement(Select<T>, props));
}
function change(value: string | number | null) {
  capture.root.onValueChange?.(value, {} as Parameters<NonNullable<typeof capture.root.onValueChange>>[1]);
}

describe("Select", () => {
  beforeEach(() => { capture.root = null!; capture.container = null; });

  it("renders a labelled trigger and preserves form name and numeric zero", () => {
    const html = render({
      id: "sample-rate", value: 0, options, onChange: () => {},
      "aria-label": "Sample rate", "aria-labelledby": "rate-label",
      className: "wide", style: { width: 120 },
    });
    expect(html).toMatch(/<button[^>]*id="sample-rate"[^>]*role="combobox"/);
    expect(html).toContain('aria-label="Sample rate"');
    expect(html).toContain('aria-labelledby="rate-label"');
    expect(html).toContain('class="app-select  wide" style="width:120px"');
    expect(html).toContain('class="app-select-value">Zero</span>');
    expect(html).toContain('name="sample-rate" value="0"');
    expect(capture.root.value).toBe(0);
    expect(capture.root).not.toHaveProperty("onOpenChange");
  });

  it("retains numeric values in change callbacks", () => {
    const onChange = vi.fn();
    render({ value: 0, options, onChange });
    change(1);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("ignores unchanged, missing, null, and disabled selections", () => {
    const onChange = vi.fn();
    render({ value: 0, options, onChange });
    for (const value of [0, 2, 3, null]) change(value);
    render({ value: 0, options, onChange, disabled: true });
    change(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps empty strings distinct from no selection", () => {
    const onChange = vi.fn();
    const stringOptions = [{ value: "", label: "Select profile" }, { value: "profile", label: "Profile" }];
    render({ value: "profile", options: stringOptions, onChange });
    change("");
    expect(onChange).toHaveBeenCalledExactlyOnceWith("");
    const html = render({ id: "profile", value: "", options: stringOptions, onChange });
    expect(capture.root.value).toBe("");
    expect(html).toContain('class="app-select-value">Select profile</span>');
    expect(html).toContain('name="profile" value=""');
  });

  it("shows the first enabled option for an unmatched value without changing it", () => {
    const onChange = vi.fn();
    render({ value: 99, options: [...options].reverse(), onChange });
    expect(capture.root.value).toBe(1);
    render({ value: 99, options: [], onChange });
    expect(capture.root.value).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders a disabled trigger", () => {
    const html = render({ value: 0, options, onChange: () => {}, disabled: true });
    expect(html).toContain('class="app-select disabled"');
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  it.each([true, false])("resolves the portal container at trigger commit (dialog: %s)", (inDialog) => {
    render({ value: 0, options, onChange: () => {} });
    const container = capture.container as { current: HTMLElement | null };
    expect(container.current).toBeNull();
    const dialog = {} as HTMLDialogElement;
    const body = {} as HTMLElement;
    const closest = vi.fn(() => inDialog ? dialog : null);
    // Model React's ref commit before Base UI's Portal layout effect reads .current.
    capture.triggerRef({ closest, ownerDocument: { body } } as unknown as HTMLButtonElement);
    expect(closest).toHaveBeenCalledWith("dialog");
    expect(container.current).toBe(inDialog ? dialog : body);
    expect(capture.container).toBe(container);
    // Fixed placement escapes the native dialog’s scrolling/clipping box.
    expect(capture.positionMethod).toBe("fixed");
    capture.triggerRef(null);
    expect(container.current).toBeNull();
  });
});
