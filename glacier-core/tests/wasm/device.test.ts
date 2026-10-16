// The real compiled Rust session, crossing asynchronous JavaScript promises.
// Fixtures retain their devicePEQ capture provenance in tests/fixtures/fiio/.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { initSync, device_operation } from "../../../src/wasm_pkg/glacier_core";

beforeAll(() => {
  initSync({ module: readFileSync(new URL("../../../src/wasm_pkg/glacier_core_bg.wasm", import.meta.url)) });
});

function capture(model: string) {
  const source = readFileSync(new URL(`../fixtures/fiio/${model}.rs`, import.meta.url), "utf8");
  const bytes = (text: string) => text.split(",").map(v => v.trim()).filter(Boolean).map(Number);
  const filters = [...source.split("filters: &[")[1].split("expected_filters:")[0]
    .matchAll(/&\[([^\]]+)\]/g)].map(match => bytes(match[1]));
  const gain = bytes(source.match(/gain: &\[([^\]]+)\]/)![1]);
  const reportId = Number(source.match(/report_id: (\d+)/)![1]);
  return { filters, gain, reportId };
}

function dac(model = "ja11", options: { missingGain?: boolean; mismatch?: boolean } = {}) {
  const recorded = capture(model);
  let filters = recorded.filters.map(bytes => [...bytes]);
  let gain = [...recorded.gain];
  const events: ({ type: "write"; bytes: number[] } | { type: "read" })[] = [];
  let pending: number[] | undefined;
  let saved = false;
  let wrote = false;
  const io = {
    async write(bytes: Uint8Array) {
      await Promise.resolve(); // Exercise a genuinely asynchronous transport.
      if (saved && model === "ja11") throw new Error("I/O after JA11 reset");
      const packet = [...bytes];
      events.push({ type: "write", bytes: packet });
      expect(packet[0]).toBe(recorded.reportId);
      const payload = packet.slice(1);
      if (payload[0] === 0xbb) {
        if (payload[4] === 0x17 && !options.missingGain) pending = gain;
        if (payload[4] === 0x15) pending = filters[payload[6]];
      } else if (payload[0] === 0xaa) {
        if (payload[4] === 0x15) {
          wrote = true;
          filters[payload[6]] = [0xbb, 0x0b, ...payload.slice(2)];
        }
        if (payload[4] === 0x17) gain = [0xbb, 0x0b, ...payload.slice(2)];
        if (payload[4] === 0x19) saved = true;
      }
    },
    async read() {
      await Promise.resolve();
      if (saved && model === "ja11") throw new Error("Read after JA11 reset");
      events.push({ type: "read" });
      const reply = pending;
      pending = undefined;
      if (!reply) return new Uint8Array();
      const result = [recorded.reportId, ...reply];
      if (options.mismatch && wrote && reply[4] === 0x17) result[8] ^= 10;
      return Uint8Array.from(result);
    },
    async sleep() { await Promise.resolve(); },
  };
  const peq = {
    global_gain: -1,
    filters: filters.map((_, index) => ({
      index, enabled: true, filter_type: "Peak", freq: 1000, gain: 1, q: 1,
    })),
  };
  const run = (request: unknown) =>
    device_operation(0x2972, model === "ja11" ? 0x0102 : 0x0093, io, request, () => {}, 1);
  return { events, peq, run };
}

describe("Rust session over the real wasm bridge", () => {
  it("JA11 verifies RAM then sends report 2 AA 0A 00 00 19 01 03 00 EE as the last I/O", async () => {
    const { events, peq, run } = dac();
    const result = await run({ command: "set_eq_state", peq, skip_verification: false });
    expect(result.globalGain).toBe(-1);
    expect(result.warnings).toEqual([]);
    expect(events.at(-1)).toEqual({
      type: "write", bytes: [2, 0xaa, 0x0a, 0, 0, 0x19, 1, 3, 0, 0xee],
    });
    const bandReads = events.filter(event => event.type === "write" && event.bytes[1] === 0xbb && event.bytes[5] === 0x15);
    expect(bandReads).toHaveLength(10); // five backup + five RAM verification
  });

  it("JA11 retains unknown-preamp warnings rather than failing an unanswered gain query", async () => {
    const { peq, run } = dac("ja11", { missingGain: true });
    const result = await run({ command: "set_eq_state", peq, skip_verification: false });
    expect(result.globalGain).toBe(-1);
    expect(result.warnings).toContain("DAC did not report its preamp; preamp was written but not verified");
  });

  it("never saves JA11 when RAM verification fails, including rollback", async () => {
    const { events, peq, run } = dac("ja11", { mismatch: true });
    await expect(run({ command: "set_eq_state", peq, skip_verification: false })).rejects.toContain("verification failed");
    expect(events.some(event => event.type === "write" && event.bytes[5] === 0x19)).toBe(false);
  });

  it("KA17 saves before the verification read", async () => {
    const { events, peq, run } = dac("ka17");
    await run({ command: "set_eq_state", peq, skip_verification: false });
    const save = events.findIndex(event => event.type === "write" && event.bytes[5] === 0x19);
    expect(save).toBeGreaterThan(0);
    expect(events.slice(save + 1).some(event => event.type === "read")).toBe(true);
  });

  it("rejects coerced commands before any I/O", async () => {
    for (const request of [
      { command: "set_dac_work_mode", isClassAb: "yes" },
      { command: "set_dac_filter_mode", mode: 42 },
      { command: "set_dac_balance", balance: 0.5 },
      { command: "set_eq_state", peq: { filters: [], global_gain: 0 }, skip_verification: "false" },
    ]) {
      const { events, run } = dac();
      await expect(run(request)).rejects.toBeDefined();
      expect(events).toEqual([]);
    }
  });
});
