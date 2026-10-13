import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastContainer } from "./Toast";
import { useToastStore, type Toast } from "../stores/toastStore";

vi.mock("../stores/toastStore", () => ({ useToastStore: vi.fn() }));

function render(toasts: Toast[], errorsOnly = false, inline = false) {
  const state = { toasts, removeToast: vi.fn(), pauseToast: vi.fn(), resumeToast: vi.fn() };
  vi.mocked(useToastStore).mockImplementation((selector: any) => selector(state));
  return renderToStaticMarkup(createElement(ToastContainer, { errorsOnly, inline }));
}

describe("Toast feedback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when there is no feedback", () => {
    expect(render([])).toBe("");
    expect(render([], true, true)).toBe("");
  });

  it("keeps routine status quiet when showing only failures", () => {
    expect(render([{ id: "info", message: "Saved", type: "success" }], true)).toBe("");
    const html = render([{ id: "error", message: "Failed to save", type: "error" }], true);
    expect(html).toContain('role="alert" aria-atomic="true"');
    expect(html).toContain("Failed to save");
  });

  it("shows only the newest error, without an inbox or duplicate message history", () => {
    const html = render([
      { id: "old", message: "Old failure", type: "error" },
      { id: "new", message: "Could not save settings", type: "error" },
      { id: "info", message: "Profile saved", type: "success" },
    ]);
    expect(html).toContain('role="alert" aria-atomic="true">Could not save settings');
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html).not.toContain("Old failure");
    expect(html).not.toContain("Profile saved");
    expect(html).not.toContain("Notifications");
    expect(html).not.toContain("notification-count");
    expect(html).not.toContain("aria-haspopup");
  });

  it("announces explicit routine feedback politely", () => {
    const html = render([{ id: "saved", message: "Profile saved", type: "success" }]);
    expect(html).toContain('role="status" aria-atomic="true"');
    expect(html).not.toContain('role="alert"');
  });

  it("keeps full messages readable and dismissible", () => {
    const message = "Device restored to factory defaults, but reading it back failed. Read EQ from the DAC again before editing.";
    const html = render([{ id: "error", message, type: "error" }]);
    expect(html).toContain(message);
    expect(html).toContain('aria-label="Dismiss message"');
    expect(html).not.toContain("Show full notification");
  });

  it("keeps feedback inside dialogs instead of behind the backdrop", () => {
    const html = render([{ id: "error", message: "Failed to save", type: "error" }], true, true);
    expect(html).toContain('class="toast-feedback inline"');
    expect(html).toContain('role="alert" aria-atomic="true"');
    expect(html).toContain("Failed to save");
  });
});
