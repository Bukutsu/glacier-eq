import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
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
