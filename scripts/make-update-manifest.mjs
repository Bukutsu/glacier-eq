#!/usr/bin/env node
// Builds the Tauri updater manifest (latest.json) from a directory of release
// assets. The app fetches it from
//   https://github.com/<repo>/releases/latest/download/latest.json
// so it goes live exactly when the maintainer publishes the draft release.
//
// Usage: make-update-manifest.mjs <assets-dir> <version> <tag> <owner/repo> [notes-file]

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Updater platform key -> the asset that platform installs. The key is
// `{os}-{arch}-{bundle type}`, which the plugin looks up from the bundle type
// patched into the running binary. Every target is required: a release that
// cannot update one platform must fail here, not ship a feed with a hole.
export const TARGETS = [
  ["linux-x86_64-appimage", /\.AppImage$/],
  ["windows-x86_64-nsis", /-setup\.exe$/],
  ["windows-x86_64-msi", /\.msi$/],
  ["darwin-aarch64-app", /_macos-aarch64\.app\.tar\.gz$/],
  ["darwin-x86_64-app", /_macos-x86_64\.app\.tar\.gz$/],
];

/**
 * @param {object} input
 * @param {Map<string, string>} input.signatures asset file name -> contents of its .sig
 */
export function buildManifest({ signatures, version, tag, repo, notes, pubDate }) {
  const platforms = {};
  for (const [key, pattern] of TARGETS) {
    const matches = [...signatures.keys()].filter((name) => pattern.test(name));
    if (matches.length !== 1) {
      throw new Error(
        `updater target ${key}: expected exactly one signed asset matching ${pattern}, found ${matches.length}`,
      );
    }
    const [name] = matches;
    const signature = signatures.get(name)?.trim();
    if (!signature) {
      throw new Error(`updater target ${key}: signature for ${name} is empty`);
    }
    platforms[key] = {
      signature,
      url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`,
    };
  }
  return { version, notes, pub_date: pubDate, platforms };
}

function readSignatures(dir) {
  const files = readdirSync(dir);
  return new Map(
    files
      .filter((name) => name.endsWith(".sig"))
      .map((sig) => [sig.slice(0, -4), join(dir, sig)])
      .filter(([asset]) => files.includes(asset))
      .map(([asset, path]) => [asset, readFileSync(path, "utf8").trim()]),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [dir, version, tag, repo, notesFile] = process.argv.slice(2);
  if (!dir || !version || !tag || !repo) {
    console.error(
      "usage: make-update-manifest.mjs <assets-dir> <version> <tag> <owner/repo> [notes-file]",
    );
    process.exit(2);
  }
  const manifest = buildManifest({
    signatures: readSignatures(dir),
    version,
    tag,
    repo,
    notes: notesFile ? readFileSync(notesFile, "utf8").trim() : "",
    pubDate: new Date().toISOString(),
  });
  writeFileSync(join(dir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${join(dir, "latest.json")} for ${Object.keys(manifest.platforms).join(", ")}`);
}
