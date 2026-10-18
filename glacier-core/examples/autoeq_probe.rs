//! End-to-end AutoEQ benchmark; compilation and quality scoring are not timed.
//! cargo run --release -p glacier-core --example autoeq_probe -- app 9
//! Modes: app | init | fit5 | wide | smooth | max | profiles | caps-profiles
//! "profiles" exercises actual protocol models, grids and packet preflight.
//! "caps-profiles" keeps the older capability-only catalog workload for comparison.

use std::hint::black_box;
use std::time::Instant;

use glacier_core::autoeq::{run_autoeq, run_autoeq_with_target, AutoEqTarget};
use glacier_core::device::capabilities::DESKTOP_DAC_CAPS;
use glacier_core::device::{EqProtocol, SUPPORTED_DEVICES};
use glacier_core::eq::{iir_math::compute_biquad_coeffs, PEQData};

fn measurement_curve() -> Vec<(f64, f64)> {
    [
        20.0, 45.0, 100.0, 220.0, 500.0, 1100.0, 2500.0, 5500.0, 12000.0, 20000.0,
    ]
    .into_iter()
    .zip([4.5, 6.2, 3.1, -1.5, -3.2, -0.8, 1.9, 3.4, 2.2, 0.5])
    .collect()
}

fn shape_rmse(peq: &PEQData, fs: f64, protocol: Option<&dyn EqProtocol>) -> f64 {
    let measurement = measurement_curve();
    let coefficients: Vec<_> = peq
        .filters
        .iter()
        .map(|band| {
            protocol.map_or_else(
                || compute_biquad_coeffs(band, fs),
                |p| p.realized_biquad(band, fs).unwrap(),
            )
        })
        .collect();
    let errors: Vec<f64> = (0..1024)
        .map(|i| {
            let freq = 20.0 * 1000.0_f64.powf(i as f64 / 1023.0);
            let omega = std::f64::consts::TAU * freq / fs;
            let response: f64 = coefficients
                .iter()
                .map(|&(b0, b1, b2, a0, a1, a2)| {
                    let real_b = b0 + b1 * omega.cos() + b2 * (2.0 * omega).cos();
                    let imag_b = -b1 * omega.sin() - b2 * (2.0 * omega).sin();
                    let real_a = a0 + a1 * omega.cos() + a2 * (2.0 * omega).cos();
                    let imag_a = -a1 * omega.sin() - a2 * (2.0 * omega).sin();
                    10.0 * ((real_b * real_b + imag_b * imag_b)
                        / (real_a * real_a + imag_a * imag_a))
                        .log10()
                })
                .sum();
            let i = measurement
                .partition_point(|&(x, _)| x < freq)
                .clamp(1, measurement.len() - 1);
            let (f0, y0) = measurement[i - 1];
            let (f1, y1) = measurement[i];
            response + y0 + (freq / f0).ln() / (f1 / f0).ln() * (y1 - y0)
        })
        .collect();
    let mean = errors.iter().sum::<f64>() / errors.len() as f64;
    (errors.iter().map(|e| (e - mean).powi(2)).sum::<f64>() / errors.len() as f64).sqrt()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(String::as_str).unwrap_or("app");
    let samples: usize = args
        .get(2)
        .map(|s| s.parse().expect("sample count"))
        .unwrap_or(9);
    assert!(samples > 0, "sample count must be positive");
    let mut caps = DESKTOP_DAC_CAPS;
    let (bands, steps, smooth) = match mode {
        "app" => (10, 2000, "none"),
        "init" => (10, 1, "none"),
        "fit5" => {
            caps.dsp_sample_rate = 48000.0;
            (5, 1000, "none")
        }
        "wide" => (10, 2000, "none"),
        "smooth" => (10, 2000, "ie"),
        "max" => {
            caps.num_bands = 32;
            (32, 2000, "none")
        }
        "profiles" | "caps-profiles" => (5, 200, "none"),
        _ => panic!("unknown mode: {mode}"),
    };
    let measurement = measurement_curve();
    let target = [(20.0, 0.0), (20000.0, 0.0)];
    let one = || -> Vec<(PEQData, f64, Option<&dyn EqProtocol>)> {
        if matches!(mode, "profiles" | "caps-profiles") {
            SUPPORTED_DEVICES
                .iter()
                .filter(|p| p.protocol.has_hardware_eq())
                .map(|profile| {
                    let caps = &profile.caps;
                    let peq = if mode == "profiles" {
                        run_autoeq_with_target(
                            &measurement,
                            &target,
                            5.min(caps.num_bands),
                            steps,
                            smooth,
                            caps.dsp_sample_rate as f32,
                            AutoEqTarget::device(caps, profile.protocol),
                        )
                    } else {
                        run_autoeq(
                            &measurement,
                            &target,
                            5.min(caps.num_bands),
                            steps,
                            smooth,
                            caps.dsp_sample_rate as f32,
                            Some(caps),
                        )
                    }
                    .unwrap_or_else(|e| panic!("{}: {e}", profile.name));
                    (
                        peq,
                        caps.dsp_sample_rate,
                        if mode == "profiles" {
                            profile.protocol.eq
                        } else {
                            None
                        },
                    )
                })
                .collect()
        } else {
            vec![(
                run_autoeq(
                    &measurement,
                    &target,
                    bands,
                    steps,
                    smooth,
                    caps.dsp_sample_rate as f32,
                    Some(&caps),
                )
                .unwrap(),
                caps.dsp_sample_rate,
                None,
            )]
        }
    };
    for _ in 0..2 {
        black_box(one());
    }
    let mut times = Vec::with_capacity(samples);
    for _ in 0..samples {
        let t = Instant::now();
        black_box(one());
        times.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    let raw = times
        .iter()
        .map(|v| format!("{v:.3}"))
        .collect::<Vec<_>>()
        .join(",");
    times.sort_by(f64::total_cmp);
    let results = one();
    // Catalog quality is the mean of per-device shape RMSEs, each evaluated at
    // that device's own DSP rate and realized model; never reuse desktop caps.
    let quality = results
        .iter()
        .map(|(peq, fs, p)| shape_rmse(peq, *fs, *p))
        .sum::<f64>()
        / results.len() as f64;
    println!("{mode}\tmedian_ms={:.3}\tmin_ms={:.3}\tmax_ms={:.3}\tshape_rmse_db={quality:.6}\tsamples={raw}",
        times[times.len()/2],times[0],times[times.len()-1]);
}
