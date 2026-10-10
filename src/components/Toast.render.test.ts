import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastContainer } from "./Toast";
import { useToastStore, type Toast } from "../stores/toastStore";

vi.mock("../stores/toastStore", () => ({ useToastStore: vi.fn() }));

function render(toasts: Toast[]) {
  const state = {
    toasts, removeToast: vi.fn(), pauseToast: vi.fn(), resumeToast: vi.fn(),
  };
  vi.mocked(useToastStore).mockImplementation((selector: any) => selector(state));
  return renderToStaticMarkup(createElement(ToastContainer));
}

describe("Toasts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reserves the notification slot when there is no feedback", () => {
    expect(render([])).toBe('<div class="toast-slot"></div>');
  });

  it("keeps routine feedback compact with one polite announcement", () => {
    const html = render([{ id: "saved", message: "Profile saved", type: "success" }]);
    expect(html).toContain('aria-label="Status messages"');
    expect(html).toContain('role="status" aria-atomic="true"');
    expect(html).toContain('aria-label="Dismiss toast"');
    expect(html).not.toContain("toast-earlier");
    expect(html).not.toContain('role="alert"');
  });

  it("prioritizes the newest error without announcing the hidden history", () => {
    const html = render([
      { id: "old", message: "Old failure", type: "error" },
      { id: "new", message: "Could not save settings", type: "error" },
      { id: "info", message: "Profile saved", type: "success" },
    ]);
    expect(html).toContain('role="alert" aria-atomic="true">Could not save settings');
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("2 more");
    expect(html).toContain('class="toast-history" hidden=""');
    expect(html).toContain('aria-label="Dismiss toast: Old failure"');
  });
});
