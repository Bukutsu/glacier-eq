import { describe, expect, it } from "vitest";
import {
  createSerialTaskQueue,
  revertFieldIfCurrent,
  setField,
} from "./serializedWrites";

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("createSerialTaskQueue", () => {
  it("starts writes in enqueue order", async () => {
    const enqueue = createSerialTaskQueue();
    const first = deferred();
    const order: string[] = [];

    const firstWrite = enqueue(async () => {
      order.push("first:start");
      await first.promise;
      order.push("first:end");
    });
    const secondWrite = enqueue(async () => {
      order.push("second");
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    first.resolve();
    await Promise.all([firstWrite, secondWrite]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("continues after a failed write", async () => {
    const enqueue = createSerialTaskQueue();
    const order: string[] = [];

    const failed = enqueue(async () => {
      order.push("failed");
      throw new Error("write failed");
    });
    const next = enqueue(async () => {
      order.push("next");
    });

    await expect(failed).rejects.toThrow("write failed");
    await next;
    expect(order).toEqual(["failed", "next"]);
  });
});

describe("revertFieldIfCurrent", () => {
  const confirmed = { filter: "old", gain: false };
  const optimistic = { filter: "new", gain: true };

  it("reverts only the failed field at the current revision", () => {
    expect(revertFieldIfCurrent(optimistic, confirmed, "filter", 2, 2))
      .toEqual({ filter: "old", gain: true });
  });

  it("keeps a newer edit to the same field", () => {
    expect(revertFieldIfCurrent(optimistic, confirmed, "filter", 1, 2))
      .toBe(optimistic);
  });

  it("applies optimistic fields without changing the input", () => {
    expect(setField(confirmed, "gain", true)).toEqual({ filter: "old", gain: true });
    expect(confirmed.gain).toBe(false);
  });
});
