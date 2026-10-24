import assert from "node:assert/strict";
import test from "node:test";
import { stampServiceWorker } from "./offlineAssets.mjs";

const template = 'const BUILD_ASSET_SET_ID = "__GLACIER_EQ_BUILD_ASSET_SET_ID__";';
const assets = [
  { path: "./index.html", hash: "index-a" },
  { path: "./assets/main.js", hash: "main-a" },
];

test("stamps the same identity for the same source and asset set", () => {
  const first = stampServiceWorker(template, assets);
  const second = stampServiceWorker(template, assets);

  assert.equal(first.identity, second.identity);
  assert.equal(first.source, second.source);
  assert.match(first.identity, /^[a-f0-9]{64}$/);
  assert.ok(first.source.includes(first.identity));
});

test("changes worker bytes when the asset set or worker template changes", () => {
  const base = stampServiceWorker(template, assets);
  const changedAssets = stampServiceWorker(template, [
    ...assets,
    { path: "./assets/lazy.js", hash: "lazy-b" },
  ]);
  const changedSource = stampServiceWorker(
    template + "\n// behavior change",
    assets,
  );

  assert.notEqual(base.identity, changedAssets.identity);
  assert.notEqual(base.source, changedAssets.source);
  assert.notEqual(base.identity, changedSource.identity);
  assert.notEqual(base.source, changedSource.source);
});

test("fails when the worker template has no unique identity marker", () => {
  assert.throws(() => stampServiceWorker("const BUILD_ASSET_SET_ID = 1;", assets));
  assert.throws(() => stampServiceWorker(
    template + "\nconst AGAIN = \"__GLACIER_EQ_BUILD_ASSET_SET_ID__\";",
    assets,
  ));
});
