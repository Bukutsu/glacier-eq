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
    ["usb_device_filter.xml", join(mainRoot, "res", "xml", "usb_device_filter.xml")],
  ];
  for (const [source, target] of overlays) {
    const content = readFileSync(join(sourceRoot, source));
    if (existsSync(target) && readFileSync(target).equals(content)) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  const manifestPath = join(mainRoot, "AndroidManifest.xml");
  const manifest = readFileSync(manifestPath, "utf8");
  const aliasPath = join(sourceRoot, "usb-attach-launcher.xml");
  const aliasMarker = 'android:name=".UsbAttachLauncher"';
  let updatedManifest = manifest;
  if (!updatedManifest.includes(aliasMarker)) {
    if (!updatedManifest.includes('android:name=".MainActivity"')) {
      throw new Error("Generated Android manifest is missing .MainActivity");
    }
    const closingTag = "</application>";
    const insertionPoint = updatedManifest.lastIndexOf(closingTag);
    if (
      insertionPoint < 0 ||
      updatedManifest.indexOf(closingTag) !== insertionPoint
    ) {
      throw new Error("Generated Android manifest has no unique application element");
    }
    const alias = readFileSync(aliasPath, "utf8");
    updatedManifest =
      updatedManifest.slice(0, insertionPoint) +
      alias +
      updatedManifest.slice(insertionPoint);
  }
  const alias = updatedManifest
    .split("<activity-alias")
    .slice(1)
    .map((part) => part.split("</activity-alias>")[0])
    .find((part) => part.includes(aliasMarker));
  if (
    !alias ||
    !alias.includes('android:targetActivity=".MainActivity"') ||
    !alias.includes('android:enabled="false"') ||
    !alias.includes("android.hardware.usb.action.USB_DEVICE_ATTACHED") ||
    !alias.includes('android:resource="@xml/usb_device_filter"') ||
    !existsSync(join(mainRoot, "res", "xml", "usb_device_filter.xml"))
  ) {
    throw new Error("USB attach launcher overlay is incomplete");
  }
  if (updatedManifest !== manifest) writeFileSync(manifestPath, updatedManifest);
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
