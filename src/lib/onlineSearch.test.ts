import { describe, expect, it } from "vitest";
import type { OnlineDevice } from "./onlineDb";
import { findOnlineMeasurements, ONLINE_RESULT_LIMIT } from "./onlineSearch";

function device(id: string, name: string): OnlineDevice {
  return { id, brand: "", name, source: "Test source", price: null };
}

describe("online measurement search", () => {
  it("does not list the entire database for an empty query", () => {
    expect(findOnlineMeasurements([device("a", "HD 600")], "  ")).toEqual({ results: [], total: 0 });
  });

  it("puts literal and single-word matches before scattered fuzzy matches", () => {
    const devices = [device("scattered", "Tuning headphones archive"), device("word", "Thieaudio Monarch"), device("literal", "Thanos")];
    const found = findOnlineMeasurements(devices, " THA ");
    expect(found.results.map((item) => item.id)).toEqual(["literal", "word", "scattered"]);
    expect(found.total).toBe(3);
  });

  it("preserves spaced model-number matching and multiple query tokens", () => {
    const hd600 = device("600", "Sennheiser HD 600");
    const hd650 = device("650", "Sennheiser HD 650");
    expect(findOnlineMeasurements([hd650, hd600], "hd600").results).toEqual([hd600]);
    expect(findOnlineMeasurements([hd650, hd600], "senn hd 600").results).toEqual([hd600]);
  });

  it("caps displayed rows without losing the total match count or stable ordering", () => {
    const devices = Array.from({ length: 70 }, (_, index) => device(String(index), `Headphone ${index}`));
    const found = findOnlineMeasurements(devices, "headphone");
    expect(found.total).toBe(70);
    expect(found.results).toEqual(devices.slice(0, ONLINE_RESULT_LIMIT));
  });

  it("still promotes late literal matches when the fuzzy bucket is full", () => {
    const fuzzy = Array.from({ length: 60 }, (_, index) => device(String(index), `Tuning headphones archive ${index}`));
    const literal = device("literal", "Thanos");
    const found = findOnlineMeasurements([...fuzzy, literal], "tha");
    expect(found.total).toBe(61);
    expect(found.results[0]).toBe(literal);
    expect(found.results).toHaveLength(ONLINE_RESULT_LIMIT);
  });
});
