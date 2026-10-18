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
   For up to five bands, compare the supported two-shelf, low-shelf, high-shelf,
   and all-peak layouts. Larger fits keep the two-shelf layout where supported.
3. **Fit continuous parameters** in `autoeq/optimizer.rs`. The solver receives
   plain bands and bounds, a correction curve, a sample rate, and a response
   model. It does not select layouts, round device parameters, or set preamp.
4. **Realize each layout** in `autoeq/device.rs`. Round frequencies and snap
   gain/Q to the protocol grids before measuring the result. Calculate a safe,
   representable preamp, then preflight all band packets without doing I/O.
5. **Score the delivered EQ**, including rounding and any headroom reduction.
   Compare centered dB error so a safety attenuation does not count as a tonal
   error. Return the best feasible layout, not the lowest unrounded solver loss.

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

The `steps` argument is now a maximum number of least-squares iterations per
layout. Zero selects the default ceiling of 80; larger values are capped at
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

In the development fixture on a Ryzen AI 7 350, pinned to CPU 0 with three
interleaved rounds of nine samples, the ten-band path fell from about 15.9 ms
to 6.6 ms and five-band fitting from 17.1 ms to 4.5 ms. Shape RMSE improved
slightly in both fixtures. The 32-band stress case was about 3% slower
(48.5 ms versus 47.2 ms), with lower shape error. The short-budget capabilities-only catalog batch was about
14% slower. The protocol-aware catalog batch took about 92 ms and adds work the
old path did not do, so it has no equivalent old benchmark. The rewrite is not
a speedup for every workload. These synthetic measurements are not a listening test or a substitute for hardware verification.
