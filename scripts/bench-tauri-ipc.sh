#!/usr/bin/env bash
set -euo pipefail

# [PERF-PROBE] Run the dev-only probe in a real Tauri WebView. The probe writes
# its report through the same save_text_file IPC command it measures.
output=${1:-.perf-tauri-ipc-results.json}
workdir=${TAURI_PERF_WORKDIR:-/tmp/glacier-eq-tauri-perf}
log=${TAURI_PERF_LOG:-.perf-tauri-ipc.log}
timeout_seconds=${TAURI_PERF_TIMEOUT:-180}

rm -rf "$workdir"
mkdir -p "$(dirname "$output")"

setsid env \
  GLACIER_EQ_HOME="$workdir" \
  VITE_TAURI_PERF=1 \
  VITE_TAURI_PERF_DIR="$workdir" \
  npm run tauri dev >"$log" 2>&1 &
pid=$!

cleanup() {
  kill -- "-$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}
trap cleanup EXIT

result="$workdir/ipc-results.json"
for ((second = 0; second < timeout_seconds; second++)); do
  if [[ -f "$result" ]]; then
    cp "$result" "$output"
    cat "$output"
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "Tauri process exited before the IPC probe completed" >&2
    tail -n 80 "$log" >&2 || true
    exit 1
  fi
  sleep 1
done

echo "Timed out waiting for Tauri IPC probe after ${timeout_seconds}s" >&2
tail -n 80 "$log" >&2 || true
exit 1
