//! [PERF-PROBE] AutoEQ end-to-end timing probe (perf run 20260913-autoeq).
//! Std-only: no criterion, no new deps. Usage:
//!   cargo run --release -p glacier-core --example autoeq_probe -- <mode> [samples]
//! Modes: app | init | fit5 | wide | profiles

use std::time::Instant;

use glacier_core::autoeq::run_autoeq;
use glacier_core::device::capabilities::DESKTOP_DAC_CAPS;
use glacier_core::device::SUPPORTED_DEVICES;

/// Deterministic measurement curve: broad low hump + mid dip + treble rise,
/// 10 log-spaced points (similar count to real PARC files).
fn measurement_curve() -> Vec<(f64, f64)> {
    let freqs = [20.0, 45.0, 100.0, 220.0, 500.0, 1100.0, 2500.0, 5500.0, 12000.0, 20000.0];
    let dbs = [4.5, 6.2, 3.1, -1.5, -3.2, -0.8, 1.9, 3.4, 2.2, 0.5];
    freqs.iter().copied().zip(dbs.iter().copied()).collect()
}

fn flat_target() -> Vec<(f64, f64)> {
    vec![(20.0, 0.0), (20000.0, 0.0)]
}

fn run_app_path() {
    let meas = measurement_curve();
    let target = flat_target();
    let _ = run_autoeq(&meas, &target, 10, 2000, "none", 48000.0, Some(&DESKTOP_DAC_CAPS)).unwrap();
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(String::as_str).unwrap_or("app");
    let samples: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(9);
    let warmups = 2;

    let mut durations: Vec<f64> = Vec::with_capacity(samples);
    match mode {
        "app" => {
            for _ in 0..warmups {
                run_app_path();
            }
            for _ in 0..samples {
                let t = Instant::now();
                run_app_path();
                durations.push(t.elapsed().as_secs_f64() * 1e3);
            }
        }
        "init" => {
            let one = || {
                let meas = measurement_curve();
                let target = flat_target();
                let _ = run_autoeq(&meas, &target, 10, 1, "none", 48000.0, Some(&DESKTOP_DAC_CAPS))
                    .unwrap();
            };
            for _ in 0..warmups {
                one();
            }
            for _ in 0..samples {
                let t = Instant::now();
                one();
                durations.push(t.elapsed().as_secs_f64() * 1e3);
            }
        }
        "fit5" => {
            let one = || {
                let meas = measurement_curve();
                let target = flat_target();
                let _ = run_autoeq(&meas, &target, 5, 1000, "none", 48000.0, Some(&DESKTOP_DAC_CAPS))
                    .unwrap();
            };
            for _ in 0..warmups {
                one();
            }
            for _ in 0..samples {
                let t = Instant::now();
                one();
                durations.push(t.elapsed().as_secs_f64() * 1e3);
            }
        }
        "wide" => {
            let mut caps = DESKTOP_DAC_CAPS;
            caps.q_range = (0.1, 20.0);
            let one = || {
                let meas = measurement_curve();
                let target = flat_target();
                let _ = run_autoeq(&meas, &target, 10, 2000, "none", 96000.0, Some(&caps)).unwrap();
            };
            for _ in 0..warmups {
                one();
            }
            for _ in 0..samples {
                let t = Instant::now();
                one();
                durations.push(t.elapsed().as_secs_f64() * 1e3);
            }
        }
        "profiles" => {
            let one = || {
                let curve = measurement_curve();
                for profile in SUPPORTED_DEVICES {
                    let _ = run_autoeq(
                        &curve,
                        &curve,
                        5.min(profile.caps.num_bands),
                        200,
                        "none",
                        profile.caps.dsp_sample_rate as f32,
                        Some(&profile.caps),
                    );
                }
            };
            for _ in 0..warmups {
                one();
            }
            for _ in 0..samples {
                let t = Instant::now();
                one();
                durations.push(t.elapsed().as_secs_f64() * 1e3);
            }
        }
        other => {
            eprintln!("unknown mode: {other} (use app|init|fit5|wide|profiles)");
            std::process::exit(2);
        }
    }

    durations.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = durations[durations.len() / 2];
    let min = durations[0];
    let max = durations[durations.len() - 1];
    println!("{mode}\tmedian_ms={median:.3}\tmin_ms={min:.3}\tmax_ms={max:.3}\tsamples={}", durations.len());
}
