# AutoEQ research

Date: 2026-09-09

Scope: what algorithm our AutoEQ port implements, whether it is correct,
and what the best configuration is for each supported DAC family.
Primary sources: the upstream AutoEq repository (cloned 2026-09-09,
commit `7ae0f56d`) and its
[How Does AutoEq Work?](https://github.com/jaakkopasanen/AutoEq/wiki/How-Does-AutoEq-Work%3F)
wiki page; all implementation claims below were checked against our own
`glacier-core/src/autoeq.rs`.

## Algorithm lineage

Upstream AutoEq has had three optimizer generations:

1. **TensorFlow custom optimizer** (original). Slow, picky dependencies.
2. **NumPy gradient optimizer** (~2022, "new parametric EQ optimizer"):
   greedy peak init (`largest_peak` style) + Adam-like joint optimization
   in log-frequency / gain / bandwidth space. **This is our vintage.**
   Our `init_pk` / `init_lsc` / `init_hsc`, `grad`, and `AdaBelief`
   are a faithful port of that generation's approach.
3. **Current upstream: scipy `fmin_slsqp`** (`autoeq/peq.py`) with a custom
   objective: MSE plus a `sharpness_penalty` (sigmoid around 18 dB/octave
   slope, computed by linear regression, not true differentiation) and a
   `band_penalty` (transition band past Nyquist), per-app configurable
   bounds (`min/max fc`, `q`, `gain` per filter), and >10 kHz treated as
   one average value (`ix10k`).

We deliberately did **not** port generation 3: SLSQP has no Rust
equivalent in our dependency tree, and our gradient core verified
correct (see below). The ideas worth stealing from gen 3 are the
*constraints*, not the optimizer: per-device bounds (done, see
"Per-DAC configuration") and a ringing guard (we keep the conservative
Q ≤ 4.0 cap instead of adding a sharpness penalty).

## Correctness audit (this repo)

- **Forward model**: `run_autoeq_optimization` evaluates candidates
  through `spectrum_values`, which delegates to the canonical
  `iir_math::accumulate_response_values` — the same code that builds USB
  packets and graph curves. The optimizer cannot drift from what the
  device renders.
- **bw ↔ Q bridge**: the optimizer works in bandwidth space
  (`alpha = sin·sinsh(ln2/2·bw)`), devices use Q
  (`alpha = sin/2Q`). `fit` converts q→bw on entry (limits included)
  and bw→q on exit; the two alphas are algebraically identical.
- **Analytic gradients**: new test
  `analytic_gradients_match_finite_differences` checks all 10
  parameter gradients (Peak/LowShelf/HighShelf × f0/gain/bw + preamp)
  against central finite differences of an independent f64 reference
  loss built on `iir_math`. All agree within ~1%. (An earlier f32
  finite-difference attempt showed phantom 15–40% mismatches — f32
  noise, not bugs. Tolerances are set at human scale: 0.05 MSE ≈
  0.01 dB/point, 10% on gradients.)
- **Preamp**: derived after optimization (`-max_gain` when needed),
  guaranteed anti-clipping. It is *not* part of the feasible set: if a
  device's preamp range is tighter than required, `clamp_to_capabilities`
  warns. Clamping preamp upward would trade the clipping guarantee for
  inaudible level precision, so this stays a warning, not silent math.

## Per-DAC configuration

`run_autoeq` now takes `Option<&DeviceCapabilities>` and optimizes
*inside* the device's feasible set (filter types + intersected
freq/gain/Q limits) instead of optimizing generic and clamping after.
Tauri, WASM, and the CLI `--device` flag all pass real caps; offline
use passes `None` (previous behavior, unchanged).

| Family | Bands | Gain | Q | Shelves | Sample rate | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Savitech/Walkplay 10-band | 10 | ±10 dB | 0.1–10 | LS+HS+8×PK | 96 kHz | Defaults bind only past ±10 dB |
| Moondrop 10-band | 10 | ±12 dB | 0.1–10 | LS+HS+8×PK | 48 kHz | Widest preamp (−20…+10) |
| FiiO JA11 / JCally JM12 | 5 | ±12 dB | 0.1–10 | LS+HS+3×PK | 48 kHz | Few bands: feasible-set fit matters most on large corrections |
| Truthear KEYX | 8 | ±12 dB | 0.1–10 | LS+HS+6×PK | 48 kHz | Tightest preamp (−20…0), integer steps |
| FiiO KA series | 10 | ±12 dB | 0.1–10 | LS+HS+8×PK | 48 kHz | Same shape as Moondrop |
| Desktop / generic | 10 | ±16 dB | 0.4–4 | LS+HS+8×PK | UI rate | Unconstrained reference |

Measured on a synthetic +14 dB hump against ±6 dB / Peak-only caps:
caps-aware fit reaches **19% lower MSE** (172.7 vs 213.9) than
optimize-generic-then-clamp, with zero band warnings. On bundled
reference curves both paths agree trivially — real curves rarely
exceed ±12 dB / Q 4, so the caps path is insurance for extreme
corrections, not a daily difference.

Deliberately conservative choices:

- Limits are **intersected, never widened**: a DAC allowing Q 10 does
  not get Q-10 filters. Narrow high-gain filters ring; the Q ≤ 4 cap
  is a ringing guard, matching upstream's sharpness-penalty intent.
- `n_bands` still comes from the UI (`maxBands` from caps); the
  optimizer always enables every band (no DAC here supports per-band
  disable).
- `fs` defaults to the connected DAC's DSP rate in the UI, so shelf
  shapes near Nyquist match the hardware (48 kHz vs 96 kHz matters).

## Future work (not done)

- Upstream-style sharpness penalty in the objective for extra ringing
  safety on 5-band devices where each band works harder.
- Preamp-range-aware gain budgeting (scale gains when the required
  preamp exceeds the device range) instead of warn-only.
- `max_time`-style budgets per DAC like upstream's `optimize()`.

Outcome: gradient core proven correct with a permanent regression
test; optimizer now device-aware with a measured quality win where
limits bind; no performance change (21.1 ms median on the standard
10-band/2000-step benchmark).
