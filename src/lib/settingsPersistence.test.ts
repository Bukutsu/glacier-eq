import { describe, expect, it, vi } from "vitest";
import { createSettingsPersistence } from "./settingsPersistence";
import type { AppSettings } from "../types";

const DEFAULTS: AppSettings = {
  auto_pull_on_connect: true,
  skip_push_verification: false,
  theme: "auto",
  snap_to_iso_frequencies: true,
  floating_graph_preview: true,
};

const STORED: AppSettings = {
  auto_pull_on_connect: false,
  skip_push_verification: true,
  theme: "dark",
  snap_to_iso_frequencies: false,
  floating_graph_preview: false,
};

function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createHarness(options: { stored?: AppSettings; loadError?: unknown } = {}) {
  const save = vi.fn(async () => undefined);
  const onChange = vi.fn();
  const onError = vi.fn();
  const persistence = createSettingsPersistence({
    defaults: DEFAULTS,
    load: async () => {
      if (options.loadError !== undefined) throw options.loadError;
      return options.stored ?? STORED;
    },
    save,
    onChange,
    onError,
  });
  return { persistence, save, onChange, onError };
}

describe("settingsPersistence", () => {
  it("hydrates stored settings without overwriting unknown stored fields", async () => {
    const { persistence, onChange, save } = createHarness({ stored: STORED });

    await persistence.load();

    expect(onChange).toHaveBeenCalledWith(STORED);
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps an edit made during the load window and persists it after hydration", async () => {
    const gate = defer<AppSettings>();
    const { persistence, onChange, save, onError } = createHarness();
    vi.spyOn(persistence as unknown as { load: () => Promise<void> }, "load");

    // Start the load; it stays pending until the gate resolves.
    const loading = persistence.load();
    const updatePromise = persistence.update("theme", "dark");
    gate.resolve(STORED);
    await Promise.all([loading, updatePromise]);

    // Optimistic UI shows the user edit, not stale defaults.
    expect(onChange).toHaveBeenLastCalledWith({ ...STORED, theme: "dark" });
    // The pre-load save is deferred so stored fields are never clobbered.
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ ...STORED, theme: "dark" });
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not persist a defaults snapshot when no edit raced the load", async () => {
    const { persistence, save } = createHarness({ stored: STORED });

    await persistence.update("theme", "dark");

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ ...STORED, theme: "dark" });
  });

  it("reports a failed load, keeps edits pending, and retries on the next change", async () => {
    const { persistence, save, onError } = createHarness({ loadError: new Error("boom") });

    await persistence.load();
    expect(onError).toHaveBeenCalledWith("load", expect.any(Error));
    expect(save).not.toHaveBeenCalled();

    await persistence.update("theme", "dark");
    expect(onError).toHaveBeenCalledTimes(2); // failed retry keeps the guard
    expect(save).not.toHaveBeenCalled();
  });

  it("reports a failed save through onError instead of throwing", async () => {
    const save = vi.fn(async () => {
      throw new Error("disk full");
    });
    const onChange = vi.fn();
    const onError = vi.fn();
    const persistence = createSettingsPersistence({
      defaults: DEFAULTS,
      load: async () => STORED,
      save,
      onChange,
      onError,
    });

    await persistence.update("theme", "dark");

    expect(onError).toHaveBeenCalledWith("save", expect.any(Error));
  });

  it("serializes concurrent saves in request order", async () => {
    const order: string[] = [];
    const persistence = createSettingsPersistence({
      defaults: DEFAULTS,
      load: async () => STORED,
      save: async (settings) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(settings.theme);
      },
      onChange: () => {},
      onError: () => {},
    });
    await persistence.load();

    await Promise.all([
      persistence.update("theme", "dark"),
      persistence.update("theme", "light"),
    ]);

    expect(order).toEqual(["dark", "light"]);
  });
});