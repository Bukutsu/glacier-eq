# AutoEQ

AutoEQ fits a measurement to a target, then publishes an EQ the selected DAC can
represent. The fitter, device rules, and headroom calculation are separate so a
faster solver cannot bypass device validation.

## Flow

1. **Prepare the correction** in `glacier-core/src/autoeq.rs`. Validate and
   interpolate the curves onto 384 logarithmic points, apply optional IE/OE
   smoothing, remove the common level, and taper the upper treble.
2. **Choose feasible bands** in the same module. Use only supported peak and
   shelf types. Intersect frequency, gain, and Q bounds with the device limits.
   Compare the supported two-shelf, low-shelf, high-shelf, and all-peak layouts
   at every band count, so shelves do not take capacity from interior features.
3. **Fit continuous parameters** in `autoeq/optimizer.rs`. The solver receives
   plain bands and bounds, a correction curve, a sample rate, and a response
   model. It does not select layouts, round device parameters, or set preamp.
4. **Realize each layout** in `autoeq/device.rs`. Round frequencies and snap
   gain/Q to the protocol grids before measuring the result. Calculate a safe,
   representable preamp, then preflight all band packets without doing I/O.
5. **Score the delivered EQ**, including rounding and any headroom reduction.
   Compare centered dB error so a safety attenuation does not count as a tonal
   error. Keep the best feasible layout as an incumbent. If a peak reached the
   legacy Q=4 ceiling, refit with the device's wider Q range. Give the least
   useful peak one residual-driven restart to recover a misplaced or zero-gain
   band. Each refinement must improve the finalized score to replace the
   incumbent. Return the best delivered result.

Parsing and AutoEQ text export retain their existing public interfaces.

## Solver

The solver uses bounded, damped nonlinear least squares (Levenberg–Marquardt).
Its parameters are log-frequency, gain scaled to comparable units, and log-Q.
The optimal common level is the mean residual and is eliminated exactly.

Coefficient construction carries three local derivatives per band. This small
forward-differentiation type keeps the Jacobian on the same equations as the
response, including Moondrop shelf slope. It does not build a computation graph.
Response and derivatives use `f64`, evaluate magnitude as real/imaginary sums of
squares, and add responses in dB. This avoids the cancellation-prone `f32`
polynomials and products of powers in the C-derived optimizer.

Each iteration forms damped normal equations and solves them with Cholesky
factorization. Coordinates at a bound are frozen when descent points outside
the feasible set. Trial steps are accepted only after their actual loss improves.
Convergence can stop the fit early.

The `steps` argument is a maximum number of least-squares iterations per local
solve. There are at most four layout solves, one wider-Q refit, and one residual
restart. Zero selects the default ceiling of 80; larger values are capped at
`MAX_OPTIMIZATION_STEPS`. These iterations are not equivalent to the old
AdaBelief gradient steps. Existing callers passing 1,000–3,000 still work, but
do not force that many least-squares iterations.

No new numerical dependency, threading runtime, unsafe code, or target-specific
SIMD is required. The same solver builds for native and WASM.

## Device model

Use `run_autoeq_with_target(..., AutoEqTarget::device(&caps, protocol))` when a
protocol is known. Native, WASM, and CLI device paths use this entrypoint.
The existing `run_autoeq(..., caps)` remains a capabilities-only API with
continuous gain and Q.

`EqProtocol` supplies the response model, gain encoding, preamp step, and Q step.
FiiO uses its 0.1 dB gain and 0.01 Q grids. Walkplay and Moondrop use their
1/256 parameter grids where applicable. Moondrop shelves use shelf slope rather
than canonical Q; fitting restricts their slope to at most one so all proposed
shelves have a valid, non-resonant design.

Protocol comparison tolerances are not quantization steps. They remain readback
and profile-matching tolerances. Walkplay and Moondrop expose the Q30 coefficients
produced by their actual encoders. Realized layout scoring and headroom use those
coefficients, including the encoded filter's stability check. Moondrop preamp
safety also accounts for its Q8 wire value, which can differ from the editor's
0.1 dB grid.

Before accepting a layout, AutoEQ builds its band packets. This catches
fixed-point coefficient limits before a user tries to push the result.
Device discovery also exposes `response_model` to the editor. Graph and
measurement-overlay calculations use that convention, so Moondrop shelf slope
is not accidentally displayed as canonical Q. Graphs remain a floating-point
preview; the core uses encoded coefficients for final scoring and safety.

FiiO firmware computes coefficients internally, so its response uses the
canonical designer after parameter quantization. Its internal coefficient
precision is unknown. None of these models guarantees analog output or
simulates the firmware's internal arithmetic bit for bit.

## Headroom

The fitting domain is 20 Hz–20 kHz. The safety domain is DC–Nyquist at the DAC's
DSP sample rate. A cached dense grid includes both endpoints; local sampled
maxima are refined, with a 0.001 dB allowance for response accumulation and
finite refinement.

Filters are realized before the safety check. Preamp rounds toward more
attenuation on the protocol grid, including integer-preamp devices. This avoids
shrinking the correction merely because nearest rounding would remove headroom.

When the preamp floor or coefficient range prevents the complete correction,
AutoEQ searches for a feasible uniformly scaled correction and scores that
actual result. This is a bounded feasibility search, not a proof that the
retained scale or layout is globally optimal.

Native fitting captures the connected device and session. A device change or
reconnect while the worker runs rejects the stale result instead of clamping it
to a different target.

## Checks and measurements

`cargo test -p glacier-core` covers numerical derivatives and forward-model
agreement at 40–768 kHz, low-frequency/high-Q cases, accepted-state loss,
redundant bands, device bounds, integer preamp, DC/Nyquist headroom, narrow peaks,
and non-flat fits that normalize and encode for every hardware-EQ catalog entry.

Run `cargo run --release -p glacier-core --example autoeq_probe -- app 9` for
end-to-end latency. Other modes are `init`, `fit5`, `smooth`, `wide`, `max`,
`profiles`, and `caps-profiles`. `profiles` measures the protocol-aware DAC path;
`caps-profiles` preserves the capabilities-only catalog workload for historical
comparisons. Samples include initialization, layout search, fitting, device
realization, and headroom validation; compilation is excluded. Pin baseline and
candidate to the same CPU when comparing on a mixed-core machine.

### Initial performance rewrite

Before the later accuracy changes, the development fixture on a Ryzen AI 7 350,
pinned to CPU 0 with three interleaved rounds of nine samples, fell from about 15.9 ms
to 6.6 ms and five-band fitting from 17.1 ms to 4.5 ms. Shape RMSE improved
slightly in both fixtures. The 32-band stress case was about 3% slower
(48.5 ms versus 47.2 ms), with lower shape error. The short-budget capabilities-only catalog batch was about
14% slower. The protocol-aware catalog batch took about 92 ms and adds work the
old path did not do, so it has no equivalent old benchmark. The rewrite is not
a speedup for every workload.

### Accuracy refinement

Run `cargo run --release -p glacier-core --example autoeq_accuracy -- train`,
or replace `train` with `holdout`. Each split has 16 synthetic corrections,
evaluated with three desktop band counts and three device protocols: 96 fits,
not 96 independent measurements. Separate seeds use the same generator.
Fixtures include shelves, overlapping peaks, narrow resonances, and ripple.

The probe matches the unchanged centering and treble taper, then scores at
2,048 log-spaced frequencies using direct complex biquad evaluation. Device
fits use encoded coefficients. Constant safety attenuation is excluded from
shape error. The coefficient designer and packet encoding are shared with
production; the evaluator is independent of the optimizer's response/loss code.

Mean held-out shape RMSE, in dB, compared with the initial performance rewrite:

| Target | Before | After | Reduction |
| :--- | ---: | ---: | ---: |
| Desktop, 3 bands | 0.344598 | 0.298773 | 13.3% |
| Desktop, 5 bands | 0.152374 | 0.136528 | 10.4% |
| Desktop, 10 bands | 0.090231 | 0.061704 | 31.6% |
| FiiO JA11, 5 bands | 0.163339 | 0.156055 | 4.5% |
| Walkplay, 5 bands | 0.159467 | 0.155882 | 2.2% |
| Moondrop Dawn Pro 2, 5 bands | 0.164958 | 0.155099 | 6.0% |

These gains cost time. In CPU-0 pinned interleaved latency runs, the existing
application fixture changed from 6.67 to 17.27 ms, five-band fitting from 4.53
to 5.10 ms, and the protocol catalog batch from 92.60 to 105.05 ms. The 32-band
stress case changed from 48.65 to 232.76 ms.

The objective is mean squared error of the preprocessed correction, not
worst-frequency error or the untapered input. In the held-out split, maximum
absolute error rose in 20 of 96 fits despite lower mean RMSE; the largest
increase was 0.826 to 1.199 dB. The older `autoeq_probe` quality metric scores
against the untapered input. Its 32-band raw shape RMSE rose from 0.0374 to
0.0510 dB; its ten-band application RMSE fell from 0.0450 to 0.0446 dB.
A few dense-grid RMSEs also rose by tiny amounts because candidates are selected
on the 384-point fitting grid: at most 0.000148 dB in training and 0.000006 dB
in the held-out split.

Per-layout restarts were rejected because an existing fit-quality guard
regressed. Dense candidate ranking and device-grid neighbor searches gave too
little additional improvement to justify their cost. These synthetic results
do not establish audible improvement, browser latency, or physical DAC accuracy.
The bounded local search still has no global-optimum guarantee.
