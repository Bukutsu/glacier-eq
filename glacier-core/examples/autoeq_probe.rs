//! Deterministic end-to-end AutoEQ benchmark, including headroom validation.
//! cargo run --release -p glacier-core --example autoeq_probe -- app 9
//! Modes: app | init | fit5 | wide | smooth | max | profiles
//! Each timed sample returns a complete, usable PEQ; compilation is not timed.

use std::hint::black_box;
use std::time::Instant;

use glacier_core::autoeq::run_autoeq;
use glacier_core::device::capabilities::DESKTOP_DAC_CAPS;
use glacier_core::device::{DeviceCapabilities, SUPPORTED_DEVICES};
use glacier_core::eq::{iir_math::accumulate_response_values, PEQData};

fn measurement_curve() -> Vec<(f64, f64)> {
    [20.0, 45.0, 100.0, 220.0, 500.0, 1100.0, 2500.0, 5500.0, 12000.0, 20000.0]
        .into_iter()
        .zip([4.5, 6.2, 3.1, -1.5, -3.2, -0.8, 1.9, 3.4, 2.2, 0.5])
        .collect()
}

fn shape_rmse(peq: &PEQData, caps: &DeviceCapabilities) -> f64 {
    let f: Vec<f32> = (0..1024)
        .map(|i| (20.0_f64 * 1000.0_f64.powf(i as f64 / 1023.0)) as f32)
        .collect();
    let measurement = measurement_curve();
    let mut response = vec![0.0; f.len()];
    for band in &peq.filters {
        accumulate_response_values(
            band.filter_type, band.freq as f64, band.gain, band.q,
            caps.dsp_sample_rate, &f, &mut response,
        );
    }
    let errors: Vec<f64> = f.iter().zip(response).map(|(&freq, db)| {
        let freq = freq as f64;
        let i = measurement.partition_point(|&(x, _)| x < freq).clamp(1, measurement.len()-1);
        let (f0, y0) = measurement[i-1];
        let (f1, y1) = measurement[i];
        let t = (freq/f0).ln() / (f1/f0).ln();
        db as f64 + y0 + t * (y1-y0)
    }).collect();
    let mean = errors.iter().sum::<f64>() / errors.len() as f64;
    (errors.iter().map(|e| (e-mean).powi(2)).sum::<f64>() / errors.len() as f64).sqrt()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(String::as_str).unwrap_or("app");
    let samples: usize = args.get(2).map(|s| s.parse().expect("sample count")).unwrap_or(9);
    assert!(samples > 0, "sample count must be positive");
    let mut caps = DESKTOP_DAC_CAPS;
    let (bands, steps, smooth) = match mode {
        "app" => (10, 2000, "none"),
        "init" => (10, 1, "none"),
        "fit5" => { caps.dsp_sample_rate = 48000.0; (5, 1000, "none") },
        "wide" => (10, 2000, "none"),
        "smooth" => (10, 2000, "ie"),
        "max" => { caps.num_bands = 32; (32, 2000, "none") },
        "profiles" => (5, 200, "none"),
        _ => panic!("unknown mode: {mode}"),
    };
    let measurement = measurement_curve();
    let target = [(20.0, 0.0), (20000.0, 0.0)];
    let one = || {
        if mode == "profiles" {
            let mut last = None;
            for profile in SUPPORTED_DEVICES.iter().filter(|p| p.protocol.has_hardware_eq()) {
                last = Some(run_autoeq(
                    &measurement, &target, 5.min(profile.caps.num_bands), steps, smooth,
                    profile.caps.dsp_sample_rate as f32, Some(&profile.caps),
                ).unwrap_or_else(|e| panic!("{}: {e}", profile.name)));
            }
            last.unwrap()
        } else {
            run_autoeq(
                &measurement, &target, bands, steps, smooth,
                caps.dsp_sample_rate as f32, Some(&caps),
            ).unwrap()
        }
    };
    for _ in 0..2 { black_box(one()); }
    let mut times = Vec::with_capacity(samples);
    for _ in 0..samples {
        let t = Instant::now();
        black_box(one());
        times.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    let raw = times.iter().map(|v| format!("{v:.3}")).collect::<Vec<_>>().join(",");
    times.sort_by(f64::total_cmp);
    let peq = one();
    println!(
        "{mode}\tmedian_ms={:.3}\tmin_ms={:.3}\tmax_ms={:.3}\tshape_rmse_db={:.6}\tsamples={raw}",
        times[times.len()/2], times[0], times[times.len()-1], shape_rmse(&peq, &caps),
    );
}
