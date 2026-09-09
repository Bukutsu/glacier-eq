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

The HID path was tuned against a connected EPZ TP35 Pro (Walkplay): pull
798 ms -> ~430 ms (-46%) and verified push 3.9 s -> ~2.0 s (-47%) by
tightening Walkplay pacing (flood 35->15 ms, post-gain 50->20 ms, per-filter
80->40 ms, commit step 500->200 ms, batch 100->50 ms, gain 50->20 ms, and a
new per-protocol init settle of 20 ms). Defaults for Moondrop/FiiO are
unchanged. The DAC occasionally drops a band response (~1 in 10 pulls at any
pacing, including stock); the existing 60-attempt retry plus second-pull and
push readback-compare absorb it, so slow outliers still verify byte-identical. A
follow-up landed Walkplay-only resends: an unanswered band/gain request is
re-sent after 15 attempts (total read budget unchanged, other protocols still
send once), so a dropped request recovers in ~0.9 s instead of ~3.9 s; healthy
pulls are unchanged at ~430 ms. Web AutoEQ remains a
follow-up candidate because it runs synchronously in the browser; changing that
would require an end-to-end worker benchmark and a larger execution-boundary
refactor.
