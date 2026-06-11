#!/usr/bin/env bash
set -u

status=0

check_cmd() {
  local name="$1"
  local hint="$2"

  if command -v "$name" >/dev/null 2>&1; then
    printf 'ok   %s -> %s\n' "$name" "$(command -v "$name")"
  else
    printf 'miss %s -> %s\n' "$name" "$hint"
    status=1
  fi
}

check_rust_target() {
  local target="$1"

  if rustup target list --installed 2>/dev/null | grep -qx "$target"; then
    printf 'ok   rust target %s\n' "$target"
  else
    printf 'miss rust target %s -> rustup target add %s\n' "$target" "$target"
    status=1
  fi
}

printf 'Android build environment\n'
printf '%s\n' '-------------------------'

check_cmd java 'install JDK 17 or use Android Studio bundled JDK'
check_cmd adb 'install Android SDK platform-tools'
check_cmd sdkmanager 'install Android SDK command-line tools'
check_cmd rustup 'install rustup'
check_cmd cargo 'install Rust'

if [ -n "${ANDROID_HOME:-}" ]; then
  printf 'ok   ANDROID_HOME=%s\n' "$ANDROID_HOME"
else
  printf 'miss ANDROID_HOME -> export ANDROID_HOME=$HOME/Android/Sdk\n'
  status=1
fi

if [ -n "${ANDROID_NDK_HOME:-}" ]; then
  printf 'ok   ANDROID_NDK_HOME=%s\n' "$ANDROID_NDK_HOME"
else
  printf 'warn ANDROID_NDK_HOME is not set; Tauri can often discover it from the SDK, but setting it removes ambiguity.\n'
fi

check_rust_target aarch64-linux-android
check_rust_target armv7-linux-androideabi
check_rust_target i686-linux-android
check_rust_target x86_64-linux-android

if command -v adb >/dev/null 2>&1; then
  printf '\nConnected devices\n'
  adb devices
fi

exit "$status"
