import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = join(root, "src-tauri", "gen", "android");
const required = [
  join(androidRoot, "settings.gradle"),
  join(androidRoot, "gradlew"),
];
const buildTask = join(
  androidRoot,
  "buildSrc",
  "src",
  "main",
  "java",
  "com",
  "bukutsu",
  "glaciereq",
  "kotlin",
  "BuildTask.kt",
);

if (required.every((path) => existsSync(path))) {
  process.exit(0);
}

const buildTaskSource = existsSync(buildTask) ? readFileSync(buildTask) : null;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["run", "android:init"], {
  cwd: root,
  stdio: "inherit",
});
if (buildTaskSource !== null) writeFileSync(buildTask, buildTaskSource);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
if (!required.every((path) => existsSync(path))) {
  console.error("Android project initialization did not produce the Gradle project entrypoints.");
  process.exit(1);
}
