import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const overlayRoot = dirname(fileURLToPath(import.meta.url));

test("existing Android projects receive an idempotent overlay and retain signing checks", () => {
  const root = mkdtempSync(join(tmpdir(), "glacier-android-overlay-"));
  try {
    const scripts = join(root, "scripts");
    const android = join(root, "src-tauri", "gen", "android");
    mkdirSync(join(scripts, "android"), { recursive: true });
    copyFileSync(join(overlayRoot, "..", "ensure-android-project.mjs"), join(scripts, "ensure-android-project.mjs"));
    for (const name of [
      "MainActivity.kt",
      "themes.xml",
      "usb_device_filter.xml",
      "usb-attach-launcher.xml",
    ]) {
      copyFileSync(join(overlayRoot, name), join(scripts, "android", name));
    }
    for (const name of ["settings.gradle", "gradlew", "tauri.settings.gradle", "app/tauri.build.gradle.kts"]) {
      const path = join(android, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "unchanged generated file");
    }
    const generatedManifest = join(android, "app/src/main/AndroidManifest.xml");
    mkdirSync(dirname(generatedManifest), { recursive: true });
    writeFileSync(generatedManifest, `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application>
        <activity android:name=".MainActivity" />
    </application>
</manifest>
`);
    const run = (...args) => spawnSync(process.execPath, [join(scripts, "ensure-android-project.mjs"), ...args], { encoding: "utf8" });
    assert.equal(run().status, 0);
    const target = join(android, "app/src/main/java/com/bukutsu/glaciereq/MainActivity.kt");
    assert.equal(readFileSync(target, "utf8"), readFileSync(join(overlayRoot, "MainActivity.kt"), "utf8"));
    for (const qualifier of ["values", "values-night"]) {
      assert.equal(readFileSync(join(android, "app/src/main/res", qualifier, "themes.xml"), "utf8"),
        readFileSync(join(overlayRoot, "themes.xml"), "utf8"));
    }
    const manifest = readFileSync(generatedManifest, "utf8");
    assert.equal(manifest.match(/<activity-alias/g)?.length, 1);
    assert.match(manifest, /android:name=".UsbAttachLauncher"/);
    assert.match(manifest, /android:resource="@xml\/usb_device_filter"/);
    const filter = join(android, "app/src/main/res/xml/usb_device_filter.xml");
    assert.equal(
      readFileSync(filter, "utf8"),
      readFileSync(join(overlayRoot, "usb_device_filter.xml"), "utf8"),
    );
    const mtime = statSync(target).mtimeMs;
    const manifestMtime = statSync(generatedManifest).mtimeMs;
    assert.equal(run().status, 0);
    assert.equal(statSync(target).mtimeMs, mtime);
    assert.equal(statSync(generatedManifest).mtimeMs, manifestMtime);
    assert.equal(readFileSync(join(android, "app/tauri.build.gradle.kts"), "utf8"), "unchanged generated file");
    const unsigned = run("--release");
    assert.equal(unsigned.status, 1);
    assert.match(unsigned.stderr, /release signing is not configured/);
    writeFileSync(join(android, "app/keystore.properties"), "test signing properties");
    writeFileSync(join(android, "app/glacier-eq.keystore"), "test keystore");
    assert.equal(run("--release").status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
