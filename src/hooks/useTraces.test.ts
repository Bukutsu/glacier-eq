import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPersistedJson,
  parseStoredActiveTargetIds,
  parseStoredMeasurements,
  parseStoredTargets,
  quarantineIfMalformed,
} from "./useTraces";
import { BUILTIN_TARGETS } from "../lib/builtinTargets";

const validPoints = [
  { freq: 100, db: 1 },
  { freq: 1000, db: 2 },
];

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
});

describe("persisted trace parsing", () => {
  it("returns valid measurements and signals malformed fields", () => {
    const parsed = parseStoredMeasurements([
      {
        id: "valid",
        name: "Valid",
        color: "red",
        visible: true,
        points: validPoints,
      },
      {
        id: "malformed",
        name: 42,
        color: "blue",
        visible: true,
        points: validPoints,
      },
    ]);

    expect(parsed.value.map((trace) => trace.id)).toEqual(["valid"]);
    expect(parsed.malformed).toBe(true);
  });

  it("keeps one trace when stored measurements share an id", () => {
    const parsed = parseStoredMeasurements([
      { id: "dup", name: "First", color: "red", visible: true, points: validPoints },
      { id: "dup", name: "Second", color: "blue", visible: true, points: validPoints },
    ]);

    expect(parsed.value.map((trace) => trace.name)).toEqual(["First"]);
    expect(parsed.malformed).toBe(true);
  });

  it("keeps one target when stored targets share an id or shadow a built-in", () => {
    const parsed = parseStoredTargets([
      { id: "dup", name: "First", color: "red", points: validPoints },
      { id: "dup", name: "Second", color: "blue", points: validPoints },
      { id: BUILTIN_TARGETS[0].id, name: "Shadow", color: "red", points: validPoints },
    ]);

    expect(parsed.value.map((target) => target.name)).toEqual(["First"]);
    expect(parsed.malformed).toBe(true);
  });

  it("accepts a legacy target without the optional builtIn field", () => {
    const parsed = parseStoredTargets([{
      id: "target",
      name: "Target",
      color: "red",
      points: validPoints,
    }]);

    expect(parsed.value).toHaveLength(1);
    expect(parsed.value[0].builtIn).toBe(false);
    expect(parsed.malformed).toBe(false);
  });

  it("signals malformed target fields", () => {
    const parsed = parseStoredTargets([{
      id: "target",
      name: "Target",
      color: null,
      points: validPoints,
    }]);

    expect(parsed.value).toEqual([]);
    expect(parsed.malformed).toBe(true);
  });

  it("keeps valid active target ids and signals invalid or stale ids", () => {
    const parsed = parseStoredActiveTargetIds(
      ["kept", 42, "missing"],
      new Set(["kept"]),
    );

    expect(parsed.value).toEqual(["kept"]);
    expect(parsed.malformed).toBe(true);
  });
});

describe("persisted trace quarantine", () => {
  it("does not treat an absent storage value as malformed", () => {
    const notify = vi.fn();

    expect(loadPersistedJson("missing", notify)).toEqual({ value: null, raw: null });
    expect(notify).not.toHaveBeenCalled();
    expect(storage.values.size).toBe(0);
  });

  it("backs up the original schema-invalid JSON before it can be sanitized", () => {
    const key = "glacier-measurements";
    const raw = JSON.stringify([{ id: "broken" }]);
    storage.setItem(key, raw);
    const loaded = loadPersistedJson(key);
    const parsed = parseStoredMeasurements(loaded.value);

    quarantineIfMalformed(key, loaded, parsed.malformed);

    const backups = [...storage.values.entries()].filter(([storedKey]) =>
      storedKey.startsWith(`${key}.bak.`)
    );
    expect(backups).toHaveLength(1);
    expect(backups[0][1]).toBe(raw);
  });

  it("uses the same backup convention for invalid JSON syntax", () => {
    const key = "glacier-user-targets";
    storage.setItem(key, "{");

    expect(loadPersistedJson(key).raw).toBeNull();
    expect([...storage.values.keys()].some((storedKey) =>
      storedKey.startsWith(`${key}.bak.`)
    )).toBe(true);
  });

  it("claims a backup copy only when the backup write succeeded", () => {
    const notify = vi.fn();
    storage.setItem("glacier-user-targets", "{");

    loadPersistedJson("glacier-user-targets", notify);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Created a backup copy"),
    );
  });

  it("does not claim a backup copy when the backup write fails", () => {
    const notify = vi.fn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    storage.setItem("glacier-user-targets", "{");
    // The backup write itself hits the quota that likely damaged the data.
    vi.spyOn(storage, "setItem").mockImplementationOnce(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    loadPersistedJson("glacier-user-targets", notify);

    // The old message announced a copy that was never written — the only
    // copy of the data is the untouched, still-malformed original.
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("no backup copy could be written"),
    );
    expect(notify).not.toHaveBeenCalledWith(
      expect.stringContaining("Created a backup copy"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Could not back up malformed saved data"),
      expect.objectContaining({ name: "QuotaExceededError" }),
    );
    warnSpy.mockRestore();
  });
});
