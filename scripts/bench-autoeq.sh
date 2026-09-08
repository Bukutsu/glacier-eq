#!/usr/bin/env bash
set -euo pipefail

measurement=${1:-target_references/Harman IE 2019.txt}
target=${2:-target_references/Harman OE 2018.txt}
bands=${3:-10}
steps=${4:-2000}
runs=${5:-6}

cargo build --release -p glacier-core --bin glacier-eq-cli >/dev/null

python3 - "$measurement" "$target" "$bands" "$steps" "$runs" <<'PY'
import statistics
import subprocess
import sys
import time

measurement, target, bands, steps, runs = sys.argv[1:]
times = []
command = [
    "target/release/glacier-eq-cli", "autoeq", measurement, target,
    "--bands", bands, "--steps", steps, "--smooth", "ie",
]
for _ in range(int(runs)):
    start = time.perf_counter()
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    times.append((time.perf_counter() - start) * 1000)
print(f"median_ms={statistics.median(times):.3f}")
print("runs_ms=" + ",".join(f"{value:.3f}" for value in times))
PY
