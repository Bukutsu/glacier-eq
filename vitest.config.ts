import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export default defineConfig({
  define: {
    __UDEV_RULES_SHA256__: JSON.stringify(createHash("sha256").update(readFileSync(new URL("./udev/69-glacier-eq.rules", import.meta.url))).digest("hex")),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@glacier-eq/backend": fileURLToPath(new URL("./src/lib/backend/tauri.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./src/testSetup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
