// The real compiled Rust session, crossing asynchronous JavaScript promises.
// Fixtures retain their devicePEQ capture provenance in tests/fixtures/fiio/.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { initSync, device_operation, list_supported_devices } from "../../../src/wasm_pkg/glacier_core";

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

function dac(model = "ja11", options: { missingGain?: boolean; mismatch?: boolean; saveError?: boolean; pid?: number } = {}) {
  const recorded = capture(model);
  let filters = recorded.filters.map(bytes => [...bytes]);
  let gain = [...recorded.gain];
  const events: ({ type: "write"; bytes: number[] } | { type: "read" })[] = [];
  let now = 0;
  const writeTimes: number[] = [];
  let pending: number[] | undefined;
  let saved = false;
  let wrote = false;
  const io = {
    nonce: 1,
    async write(bytes: Uint8Array) {
      await Promise.resolve(); // Exercise a genuinely asynchronous transport.
      if (saved && model === "ja11") throw new Error("I/O after JA11 reset");
      const packet = [...bytes];
      events.push({ type: "write", bytes: packet });
      writeTimes.push(now);
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
        if (payload[4] === 0x19) {
          saved = true;
          if (options.saveError) throw new Error("ambiguous save delivery");
        }
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
    async sleep(ms: number) { now += ms; await Promise.resolve(); },
  };
  const peq = {
    global_gain: -1,
    filters: filters.map((_, index) => ({
      index, enabled: true, filter_type: "Peak", freq: 1000, gain: 1, q: 1,
    })),
  };
  const run = (request: unknown) =>
    device_operation(0x2972, options.pid ?? (model === "ja11" ? 0x0102 : model === "ka15" ? 0x0104 : 0x0093), io, request, () => {}, io.nonce);
  return { events, peq, run, writeTimes };
}

describe("Rust session over the real wasm bridge", () => {
  it.each([0x0101, 0x0102])("JA11 %s keeps pacing/order and treats Save as a single-shot boundary", async pid => {
    for (const skip_verification of [false, true]) {
      for (const saveError of [false, true]) {
        const { events, peq, run, writeTimes } = dac("ja11", { pid, saveError });
        const pending = run({ command: "set_eq_state", peq, skip_verification });
        if (saveError) await expect(pending).rejects.toContain("delivery uncertain");
        else expect(await pending).toMatchObject({ restarts: true });
        const sets = events.filter(event => event.type === "write" && event.bytes[1] === 0xaa);
        expect(sets.map(event => event.type === "write" && event.bytes[5])).toEqual([
          0x16, 0x15, 0x15, 0x15, 0x15, 0x15, 0x17, 0x18, 0x19,
        ]);
        expect(sets.at(-2)).toEqual({ type: "write", bytes: [2, 0xaa, 0x0a, 0, 0, 0x18, 1, 1, 0, 0xee] });
        expect(events.at(-1)).toEqual({ type: "write", bytes: [2, 0xaa, 0x0a, 0, 0, 0x19, 1, 3, 0, 0xee] });
        expect(writeTimes[0]).toBeGreaterThanOrEqual(500);
        for (let index = 1; index < writeTimes.length; index++) {
          expect(writeTimes[index] - writeTimes[index - 1]).toBeGreaterThanOrEqual(200);
        }
      }
    }
  });

  it.each([0x0101, 0x0102])("JA11 %s exposes controls via real WASM, with native wire fixtures", async pid => {
    const values: Record<number, number> = { 2: 30, 0x12: 1, 0x20: 1 };
    const writes: number[][] = [];
    let pending: Uint8Array | undefined;
    let corrupt = false;
    let mismatch = false;
    let failedCommand: number | undefined;
    const io = {
      nonce: 42,
      async write(bytes: Uint8Array) {
        await Promise.resolve();
        const p = [...bytes];
        writes.push(p);
        if (p[1] === 0xbb && p[5] !== failedCommand) {
          pending = Uint8Array.of(2, 0xbb, 0x0b, 7, 9, p[5], corrupt ? 2 : 1, values[p[5]], 0x51, 0xee, 0, 0);
        } else if (p[1] === 0xaa && !mismatch) values[p[5]] = p[7];
      },
      async read() { const reply = pending; pending = undefined; return reply ?? new Uint8Array(); },
      async sleep() { await Promise.resolve(); },
    };
    const run = (control: string, value?: unknown, vid = 0x2972, product = pid) =>
      device_operation(vid, product, io, { command: "ja11_control", control, ...(value === undefined ? {} : { value }) }, () => {}, io.nonce);
    expect(await run("volume")).toBe(30);
    expect(await run("volume", 29)).toBe(29);
    expect(writes.slice(-3)).toEqual([
      [2, 0xbb, 0x0b, 0, 0, 2, 0, 0, 0xee],
      [2, 0xaa, 0x0a, 0, 0, 2, 1, 29, 0, 0xee],
      [2, 0xbb, 0x0b, 0, 0, 2, 0, 0, 0xee],
    ]);
    for (const control of ["microphone", "uac"]) {
      const before = writes.length;
      expect(await run(control, 0)).toBeNull();
      expect(writes.length - before).toBe(2); // fresh read + write, no post-write read
    }
    expect(io.nonce).toBe(42); // controls do not consume filter nonces
    expect(writes.every(p => [2, 0x12, 0x20].includes(p[5]))).toBe(true);
    for (const [control, value] of [["volume", 61], ["volume", -1], ["volume", 1.5], ["volume", "30"], ["uac", 2], ["unknown", 0]]) {
      const before = writes.length;
      await expect(run(control as string, value)).rejects.toBeDefined();
      expect(writes.length).toBe(before);
    }
    for (const product of [0x0104, 0x0093]) {
      const before = writes.length;
      await expect(run("volume", 20, 0x2972, product)).rejects.toContain("require a JA11");
      expect(writes.length).toBe(before);
    }
    corrupt = true;
    let before = writes.length;
    await expect(run("volume", 10)).rejects.toContain("read timeout");
    expect(writes.length - before).toBe(1);
    corrupt = false;
    failedCommand = 0x12;
    await expect(run("microphone")).rejects.toContain("read timeout");
    expect(await run("uac")).toBe(0); // one failed field does not block the others
    mismatch = true;
    before = writes.length;
    await expect(run("volume", 28)).rejects.toContain("verification failed");
    expect(writes.length - before).toBe(3); // no rollback/save after mismatch
  });

  it.each([false, true])("retains consumed nonces across commands, including failure=%s", async failed => {
    // Walkplay carries the request nonce in response byte 2. Simulate a late
    // band-0 response from the first operation, arriving AFTER the next drain.
    const requests: number[] = [];
    let phase = 0;
    let stale: Uint8Array | undefined;
    const pending: Uint8Array[] = [];
    const response = (request: Uint8Array, freq: number) => {
      const bytes = new Uint8Array(35);
      bytes.set([0x4b, 0x80, 0x09, request[3], 0, request[5]]);
      const view = new DataView(bytes.buffer);
      view.setUint16(28, freq, true);
      view.setUint16(30, 256, true);
      view.setInt16(32, 256, true);
      bytes[34] = 2;
      return bytes;
    };
    const io = {
      nonce: 1,
      async write(request: Uint8Array) {
        if (request[2] === 0x09) {
          requests.push(request[3]);
          if (phase === 0 && request[5] === 0) {
            stale = response(request, 777);
            // Force a full-pull retry before success, or fail both attempts.
            if (failed || requests.length === 1) throw new Error("transient read request failure");
          }
          if (phase === 1 && stale) {
            pending.push(stale);
            stale = undefined;
          }
          pending.push(response(request, 1000));
        } else if (request[2] === 0x03) {
          pending.push(Uint8Array.of(0x4b, 0x80, 0x03, 0, 0, 1, 0));
        }
      },
      async read() { return pending.shift() ?? new Uint8Array(); },
      async sleep() { await Promise.resolve(); },
    };
    const run = () => device_operation(0x3302, 0x43e6, io, { command: "get_eq_state" }, () => {}, io.nonce);
    if (failed) await expect(run()).rejects.toContain("transient read request failure");
    else await expect(run()).resolves.toMatchObject({ globalGain: 1 });
    const lastNonce = requests.at(-1)!;
    expect(io.nonce).toBe(lastNonce);
    const previousRequests = requests.length;
    phase = 1;
    const result = await run();
    expect(requests[previousRequests]).toBe(lastNonce + 1);
    expect(result.filters[0].freq).toBe(1000); // Not the stale 777 Hz response.
    expect(io.nonce).toBe(requests.at(-1));
  });

  it("exports specs and control capabilities from the matched catalog entries", () => {
    const catalog = list_supported_devices();
    const tp35 = catalog.find((profile: any) => profile.vendor_id === 0x3302 && profile.product_id === 0x43e6);
    expect(tp35.controls).toBe("walkplay");
    expect(tp35.spec.chip).toBe("Dual CS43198");
    expect(tp35.spec.maxPower).toBe("262mW @ 32Ω");
    const dawn = catalog.find((profile: any) => profile.vendor_id === 0x2fc6 && profile.product_id === 0xf06a);
    expect(dawn.hardware_eq).toBe(false);
    expect(dawn.controls).toBe("dawn_pro");
    const fallback = catalog.find((profile: any) => profile.vendor_id === 0x2fc6 && profile.product_id === null);
    expect(fallback.controls).toBeNull();
  });

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

  it.each([0x0101, 0x0102])("JA11 %s fails fast on a silent preamp without mutating/re-saving", async pid => {
    const { events, peq, run } = dac("ja11", { missingGain: true, pid });
    await expect(run({ command: "set_eq_state", peq, skip_verification: false })).rejects.toContain("DAC is not responding");
    const writes = events.filter(event => event.type === "write");
    expect(writes).toEqual([{ type: "write", bytes: [2, 0xbb, 0x0b, 0, 0, 0x17, 0, 0, 0xee] }]);
  });

  it("never saves JA11 when RAM verification fails, including rollback", async () => {
    const { events, peq, run } = dac("ja11", { mismatch: true });
    await expect(run({ command: "set_eq_state", peq, skip_verification: false })).rejects.toContain("verification failed");
    expect(events.some(event => event.type === "write" && event.bytes[5] === 0x19)).toBe(false);
  });

  it.each(["ka15", "ka17"])("%s retains count-before-bands and save-before-readback", async model => {
    const { events, peq, run } = dac(model);
    await run({ command: "set_eq_state", peq, skip_verification: false });
    const save = events.findIndex(event => event.type === "write" && event.bytes[5] === 0x19);
    expect(save).toBeGreaterThan(0);
    const sets = events.filter(event => event.type === "write" && event.bytes[1] === 0xaa);
    expect(sets.slice(0, 3).map(event => event.type === "write" && event.bytes[5])).toEqual([0x16, 0x18, 0x15]);
    expect(sets).toHaveLength(14); // select + count + 10 bands + preamp + Save
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
