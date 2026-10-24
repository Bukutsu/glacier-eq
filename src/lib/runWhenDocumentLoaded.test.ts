import { describe, expect, it, vi } from "vitest";
import { runWhenDocumentLoaded } from "./runWhenDocumentLoaded";

describe("runWhenDocumentLoaded", () => {
  it("runs immediately when the load event has already fired", () => {
    const addLoadListener = vi.fn();
    const action = vi.fn();

    runWhenDocumentLoaded("complete", addLoadListener, action);

    expect(action).toHaveBeenCalledOnce();
    expect(addLoadListener).not.toHaveBeenCalled();
  });

  it("registers a one-shot load callback before completion", () => {
    let listener: (() => void) | undefined;
    const addLoadListener = vi.fn((callback: () => void) => {
      listener = callback;
    });
    const action = vi.fn();

    runWhenDocumentLoaded("interactive", addLoadListener, action);

    expect(addLoadListener).toHaveBeenCalledOnce();
    expect(action).not.toHaveBeenCalled();
    listener?.();
    expect(action).toHaveBeenCalledOnce();
  });
});
