import { spawnSync } from "child_process";
import { env, exit } from "process";

const newEnv = { ...env, RUSTFLAGS: "" };
const result = spawnSync(
  "wasm-pack",
  ["build", "--target", "web", "--out-dir", "../src/wasm_pkg", "glacier-core"],
  {
    stdio: "inherit",
    env: newEnv,
    shell: true,
  }
);

exit(result.status ?? 0);
