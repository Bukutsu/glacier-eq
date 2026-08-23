import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPersistedJson,
  parseStoredActiveTargetIds,
  parseStoredMeasurements,
  parseStoredTargets,
  quarantineIfMalformed,
} from "./useTraces";

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
});
