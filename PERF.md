# Performance ledger

All measurements discarded a warm-up run and used five runs. CPU-bound synthetic
benchmarks were pinned to CPU 0.

| Attempt | Baseline -> result | Verdict | Finding |
| --- | --- | --- | --- |
| Graph response draw, 800 points, 10 enabled bands | 0.211 ms -> 0.093 ms | Kept | One WASM pass now produces the aggregate and per-band curves. |
| Graph response draw with committed preview | 0.310 ms -> 0.188 ms | Kept | Removed duplicate per-band response work from the animated draw path. |
| Native AutoEQ, 10 bands, 2,000 steps | 65 ms -> 23 ms | Kept | `glacier-core` uses `opt-level = 3`; output is identical. |
| Profile save with 250 stored profiles | 1.071 ms -> 0.012 ms | Kept | Reused the existing destination lookup instead of parsing every profile. |
| Online database JSON + curve validation, 5,000 x 384 points | 68.0 ms -> 41.0 ms | Kept | Validated numeric arrays in place instead of allocating copies. |
| Warm production build | 2.54 s -> 2.58 s | Tradeoff | The faster core adds about 3 KB gzip to the WASM bundle. |
| Frontend tests | Green -> Green | Verified | 100 tests passed. |
| Rust workspace tests | Green -> Green | Verified | 112 tests passed. |

Representative commands:

```sh
npm test -- --run
cargo test --workspace
npm run build
cargo build --release -p glacier-core
```

The HID path was not changed: its waits are protocol timing requirements, and no
physical DAC was available for a safe latency experiment. Web AutoEQ remains a
follow-up candidate because it runs synchronously in the browser; changing that
would require an end-to-end worker benchmark and a larger execution-boundary
refactor.
