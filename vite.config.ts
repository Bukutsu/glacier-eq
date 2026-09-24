import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

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
      "@glacier-eq/backend": backend,
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    {
      name: "offline-assets",
      generateBundle(_, bundle) {
        const assets = new Map<string, OfflineAsset>();
        for (const output of Object.values(bundle)) {
          const path = `./${output.fileName}`;
          const source = "source" in output ? output.source : output.code;
          assets.set(path, {
            path,
            hash: hashBytes(typeof source === "string" ? source : new Uint8Array(source)),
          });
        }
        for (const asset of collectPublicAssets()) assets.set(asset.path, asset);
        const indexPath = "./index.html";
        if (!assets.has(indexPath)) {
          assets.set(indexPath, {
            path: indexPath,
            hash: hashBytes(readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)))),
          });
        }
        this.emitFile({
          type: "asset",
          fileName: "offline-assets.json",
          source: JSON.stringify([...assets.values()]),
        });
      },
    },
  ],
  base: process.env.VITE_BASE_PATH || "./",

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
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  };
});
