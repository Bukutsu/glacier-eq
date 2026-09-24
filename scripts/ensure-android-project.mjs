import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = join(root, "src-tauri", "gen", "android");
const entrypoints = [
  join(androidRoot, "settings.gradle"),
  join(androidRoot, "gradlew"),
];
// Tauri creates these ignored includes during the subsequent Android
// dev/build command. They are readiness signals, not files `android:init`
// itself is expected to emit.
const generatedIncludes = [
  join(androidRoot, "tauri.settings.gradle"),
  join(androidRoot, "app", "tauri.build.gradle.kts"),
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

if (
  entrypoints.every((path) => existsSync(path))
  && generatedIncludes.every((path) => existsSync(path))
) {
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
if (!entrypoints.every((path) => existsSync(path))) {
  console.error("Android project initialization did not produce the Gradle project entrypoints.");
  process.exit(1);
}
