// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The 0.10.1 bump updated package.json and both Tauri manifests but left
 * package-lock.json at 0.10.0 — release tooling and reviewers reading the
 * lock saw a different version than the shipped app reports. Every file
 * that carries the project version must agree.
 */
function packageTomlVersion(): string {
  const toml = readFileSync("src-tauri/Cargo.toml", "utf8");
  const match = toml.match(/^\[package\]\s*[\s\S]*?^version = "([^"]+)"/m);
  if (!match) throw new Error("no version in Cargo.toml [package]");
  return match[1];
}

describe("version parity", () => {
  const expected = JSON.parse(readFileSync("package.json", "utf8")).version as string;

  it("package.json declares a version", () => {
    expect(expected).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("package-lock.json root and packages[''] match package.json", () => {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    expect(lock.version).toBe(expected);
    expect(lock.packages?.[""]?.version).toBe(expected);
  });

  it("tauri.conf.json matches package.json", () => {
    const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
    expect(conf.version).toBe(expected);
  });

  it("src-tauri Cargo.toml [package] matches package.json", () => {
    expect(packageTomlVersion()).toBe(expected);
  });
});
