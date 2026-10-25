import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { stampServiceWorker } from "./scripts/offlineAssets.mjs";

type OfflineAsset = { path: string; hash: string };

function hashBytes(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function collectPublicAssets(
  directory = fileURLToPath(new URL("./public", import.meta.url)),
  root = directory,
): OfflineAsset[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectPublicAssets(path, root);
    return [{
      path: `./${relative(root, path).replaceAll("\\", "/")}`,
      hash: hashBytes(readFileSync(path)),
    }];
  });
}

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const appVersion = process.env.VITE_APP_VERSION || process.env.npm_package_version || "unknown";

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  const runtime = mode === "web" ? "web" : "tauri";
  const backend = fileURLToPath(new URL(`./src/lib/backend/${runtime}.ts`, import.meta.url));

  return {
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@glacier-eq/backend": backend,
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "offline-assets",
      writeBundle(options, bundle) {
        const outDir = options.dir ?? fileURLToPath(new URL("./dist", import.meta.url));
        const paths = new Set<string>();
        for (const fileName of Object.keys(bundle)) paths.add(fileName);
        for (const asset of collectPublicAssets()) {
          paths.add(asset.path.replace(/^\.\//, ""));
        }
        paths.add("index.html");

        const assets = [...paths]
          .filter((path) => path !== "offline-assets.json" && path !== "sw.js")
          .sort()
          .map((path): OfflineAsset => ({
            path: `./${path}`,
            // Hash the bytes actually written to dist, after all Vite/Rollup
            // transformations and public-asset copying have completed.
            hash: hashBytes(readFileSync(join(outDir, path))),
          }));

        // The worker script itself must change whenever the precached asset set
        // changes, or browsers will keep the old worker and its old manifest.
        // The identity is derived without sw.js to avoid a circular digest.
        const workerPath = join(outDir, "sw.js");
        const worker = stampServiceWorker(readFileSync(workerPath, "utf8"), assets);
        writeFileSync(workerPath, worker.source);

        const manifest = [
          ...assets,
          { path: "./sw.js", hash: hashBytes(worker.source) },
        ].sort((left, right) =>
          left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
        );
        writeFileSync(
          join(outDir, "offline-assets.json"),
          JSON.stringify(manifest),
        );
      },
    },
  ],
  base: process.env.VITE_BASE_PATH || "./",
  // Scan only the app entry. By default Vite crawls every *.html under the
  // root, including Cargo's target/ (tens of GB) and Android build reports,
  // which delays the first page load in `tauri dev` by seconds.
  optimizeDeps: {
    entries: ["index.html"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and Cargo build output
      ignored: ["**/src-tauri/**", "**/target/**"],
    },
  },
  };
});
