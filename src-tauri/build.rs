fn main() {
    tauri_build::build();

    // Android 15+ (API 35) devices may use 16 KB memory pages. The NDK links
    // ELF segments with 4 KB alignment by default, which makes the app
    // "not 16 KB compatible" and rejected on those devices/emulators. Align
    // loadable segments to 16 KB so the native library loads everywhere.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
    }
}
