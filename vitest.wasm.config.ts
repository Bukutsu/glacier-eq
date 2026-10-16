import { defineConfig } from "vitest/config";

// Integration tests load the generated module, unlike the hermetic UI tests.
export default defineConfig({
  test: {
    environment: "node",
    include: ["glacier-core/tests/wasm/**/*.test.ts"],
  },
});
