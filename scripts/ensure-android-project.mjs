import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const releaseRequested = process.argv.includes("--release");
const signingProperties = join(androidRoot, "app", "keystore.properties");
const signingKeystore = join(androidRoot, "app", "glacier-eq.keystore");

function applyAndroidOverlay() {
  const sourceRoot = join(root, "scripts", "android");
  const mainRoot = join(androidRoot, "app", "src", "main");
  const overlays = [
    ["MainActivity.kt", join(mainRoot, "java", "com", "bukutsu", "glaciereq", "MainActivity.kt")],
    ["themes.xml", join(mainRoot, "res", "values", "themes.xml")],
    ["themes.xml", join(mainRoot, "res", "values-night", "themes.xml")],
  ];
  for (const [source, target] of overlays) {
    const content = readFileSync(join(sourceRoot, source));
    if (existsSync(target) && readFileSync(target).equals(content)) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function requireReleaseSigning() {
  if (!releaseRequested) return;
  if (!existsSync(signingProperties) || !existsSync(signingKeystore)) {
    console.error(
      "Android release signing is not configured. Install the CI signing overlay and keystore before running android:apk:release.",
    );
    process.exit(1);
  }
}

if (
  entrypoints.every((path) => existsSync(path))
  && generatedIncludes.every((path) => existsSync(path))
) {
  applyAndroidOverlay();
  requireReleaseSigning();
  process.exit(0);
}

const buildTaskSource = existsSync(buildTask) ? readFileSync(buildTask) : null;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["run", "android:init"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    CI: process.env.CI === "1" ? "true" : process.env.CI,
  },
});
if (buildTaskSource !== null) writeFileSync(buildTask, buildTaskSource);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
if (!entrypoints.every((path) => existsSync(path))) {
  console.error("Android project initialization did not produce the Gradle project entrypoints.");
  process.exit(1);
}
applyAndroidOverlay();
requireReleaseSigning();
