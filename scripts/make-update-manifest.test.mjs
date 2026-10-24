import assert from "node:assert/strict";
import test from "node:test";
import { buildManifest, TARGETS } from "./make-update-manifest.mjs";

const names = [
  "Glacier-EQ_0.16.0_amd64.AppImage",
  "Glacier-EQ_0.16.0_x64-setup.exe",
  "Glacier-EQ_0.16.0_x64_en-US.msi",
  "glacier-eq_v0.16.0_macos-aarch64.app.tar.gz",
  "glacier-eq_v0.16.0_macos-x86_64.app.tar.gz",
];
const signed = (list) => new Map(list.map((name) => [name, `sig:${name}`]));
const input = (signatures) => ({
  signatures,
  version: "0.16.0",
  tag: "v0.16.0",
  repo: "Bukutsu/glacier-eq",
  notes: "notes",
  pubDate: "2026-01-01T00:00:00.000Z",
});

test("maps every updater target to its signed asset and release URL", () => {
  const manifest = buildManifest(input(signed(names)));
  assert.equal(manifest.version, "0.16.0");
  assert.deepEqual(Object.keys(manifest.platforms), TARGETS.map(([key]) => key));
  assert.deepEqual(manifest.platforms["windows-x86_64-nsis"], {
    signature: "sig:Glacier-EQ_0.16.0_x64-setup.exe",
    url: "https://github.com/Bukutsu/glacier-eq/releases/download/v0.16.0/Glacier-EQ_0.16.0_x64-setup.exe",
  });
});

test("ignores unsigned and unrelated assets", () => {
  const manifest = buildManifest(
    input(signed([...names, "Glacier-EQ_0.16.0_amd64.deb"])),
  );
  assert.equal(Object.keys(manifest.platforms).length, TARGETS.length);
});

test("fails when a selected asset has an empty signature", () => {
  const signatures = signed(names);
  signatures.set(names[0], " \n\t");
  assert.throws(
    () => buildManifest(input(signatures)),
    /linux-x86_64-appimage: signature .* is empty/,
  );
});

test("fails when a platform has no signed asset", () => {
  assert.throws(
    () => buildManifest(input(signed(names.filter((n) => !n.endsWith(".msi"))))),
    /windows-x86_64-msi.*found 0/,
  );
});

test("fails when a platform is ambiguous", () => {
  assert.throws(
    () => buildManifest(input(signed([...names, "Other.AppImage"]))),
    /linux-x86_64-appimage.*found 2/,
  );
});
