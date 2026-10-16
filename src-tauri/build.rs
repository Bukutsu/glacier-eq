fn main() {
    // The privileged installer verifies the staged rules against the bytes
    // embedded in this build. Keep no hand-maintained digest or commit pin.
    println!("cargo:rerun-if-changed=../udev/69-glacier-eq.rules");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        let output = std::process::Command::new("sha256sum")
            .arg("../udev/69-glacier-eq.rules")
            .output()
            .expect("sha256sum is required for Linux builds");
        assert!(output.status.success(), "failed to hash udev rules");
        let output = String::from_utf8(output.stdout).expect("sha256sum output");
        let digest = output.split_whitespace().next().expect("udev rules digest");
        assert!(digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit()));
        println!("cargo:rustc-env=GLACIER_UDEV_SHA256={digest}");
    }
    tauri_build::build();

    // Android 15+ (API 35) devices may use 16 KB memory pages. The NDK links
    // ELF segments with 4 KB alignment by default, which makes the app
    // "not 16 KB compatible" and rejected on those devices/emulators. Align
    // loadable segments to 16 KB so the native library loads everywhere.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
    }
}
