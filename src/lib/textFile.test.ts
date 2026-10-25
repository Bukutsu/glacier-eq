import { describe, expect, it, vi } from "vitest";
import { readTextFile } from "./textFile";

describe("text file imports", () => {
  it("keeps the filename and BOM for the parser", async () => {
    expect(
      await readTextFile(new File(["\uFEFFPreamp: -2 dB"], "ÉQ.txt")),
    ).toEqual({
      name: "ÉQ.txt",
      text: "\uFEFFPreamp: -2 dB",
    });
  });
  it("rejects oversized files before reading them", async () => {
    const file = new File(["x".repeat(1_048_577)], "large.txt");
    const read = vi.spyOn(file, "arrayBuffer");
    await expect(readTextFile(file)).rejects.toThrow("1 MiB");
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects damaged UTF-8 instead of silently changing the imported text", async () => {
    await expect(
      readTextFile(new File([new Uint8Array([0xff])], "broken.txt")),
    ).rejects.toThrow();
  });
  it("surfaces a failed file read", async () => {
    const file = new File(["text"], "unreadable.txt");
    vi.spyOn(file, "arrayBuffer").mockRejectedValue(new Error("Read failed"));
    await expect(readTextFile(file)).rejects.toThrow("Read failed");
  });
});
