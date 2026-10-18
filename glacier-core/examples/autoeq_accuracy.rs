//! Delivered-response accuracy probe. Run in release mode; scores use a dense
//! independent complex-frequency evaluator, not the optimizer's loss function.
//! Synthetic corrections exercise recovery/local minima, not listening quality.
//! cargo run --release -p glacier-core --example autoeq_accuracy -- train
//! Use "holdout" for separate deterministic seeds not used during experiments.
use glacier_core::autoeq::{run_autoeq_with_target, AutoEqTarget};
use glacier_core::device::capabilities::DESKTOP_DAC_CAPS;
use glacier_core::device::{get_supported_device, EqProtocol};
use glacier_core::eq::{iir_math::compute_biquad_coeffs, Filter, FilterType};
use std::time::Instant;

type Coefficients = (f64, f64, f64, f64, f64, f64);

fn response(c: Coefficients, frequency: f64, fs: f64) -> f64 {
    let (b0, b1, b2, a0, a1, a2) = c;
    let w = std::f64::consts::TAU * frequency / fs;
    let real_b = b0 + b1 * w.cos() + b2 * (2.0 * w).cos();
    let imag_b = -b1 * w.sin() - b2 * (2.0 * w).sin();
    let real_a = a0 + a1 * w.cos() + a2 * (2.0 * w).cos();
    let imag_a = -a1 * w.sin() - a2 * (2.0 * w).sin();
    10.0 * ((real_b * real_b + imag_b * imag_b) / (real_a * real_a + imag_a * imag_a)).log10()
}

fn random(seed: &mut u64) -> f64 {
    *seed = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    (*seed >> 11) as f64 / ((1_u64 << 53) as f64)
}

fn fixture(seed: u64, frequencies: &[f64]) -> Vec<(f64, f64)> {
    let mut rng = seed + 1;
    let count = 3 + seed as usize % 7;
    let mut coefficients = Vec::new();
    for i in 0..count {
        let kind = match (seed % 4, i) {
            (0 | 1, 0) => FilterType::LowShelf,
            (0 | 2, 1) => FilterType::HighShelf,
            _ => FilterType::Peak,
        };
        let freq = match kind {
            FilterType::LowShelf => 60.0 + 200.0 * random(&mut rng),
            FilterType::HighShelf => 4000.0 + 5000.0 * random(&mut rng),
            _ => 45.0 * 250.0_f64.powf(random(&mut rng)),
        };
        let gain = 12.0 * random(&mut rng) - 6.0;
        let q = if kind == FilterType::Peak {
            0.5 * 7.0_f64.powf(random(&mut rng))
        } else {
            0.7
        };
        coefficients.push(compute_biquad_coeffs(
            &Filter {
                index: i as u8,
                enabled: true,
                filter_type: kind,
                freq: freq.round() as u16,
                gain,
                q,
            },
            96000.0,
        ));
    }
    frequencies
        .iter()
        .map(|&f| {
            let mut db = coefficients
                .iter()
                .map(|&c| response(c, f, 96000.0))
                .sum::<f64>();
            // Non-biquad structure checks approximation as well as exact recovery.
            if seed % 5 == 4 {
                db += 0.6 * (f.ln() * 9.0).sin() * (-((f / 2500.0).ln() / 2.0).powi(2)).exp();
            }
            (f, db)
        })
        .collect()
}

fn interpolate(points: &[(f64, f64)], f: f64) -> f64 {
    let i = points
        .partition_point(|&(x, _)| x < f)
        .clamp(1, points.len() - 1);
    let (f0, y0) = points[i - 1];
    let (f1, y1) = points[i];
    y0 + (y1 - y0) * (f / f0).ln() / (f1 / f0).ln()
}

fn scores(
    filters: &[Filter],
    fs: f64,
    protocol: Option<&dyn EqProtocol>,
    target: &[(f64, f64)],
) -> (f64, f64) {
    let c: Vec<_> = filters
        .iter()
        .map(|f| {
            protocol.map_or_else(
                || compute_biquad_coeffs(f, fs),
                |p| p.realized_biquad(f, fs).unwrap(),
            )
        })
        .collect();
    let errors: Vec<_> = (0..2048)
        .map(|i| {
            let f = 20.0 * 1000.0_f64.powf(i as f64 / 2047.0);
            c.iter().map(|&c| response(c, f, fs)).sum::<f64>() - interpolate(target, f)
        })
        .collect();
    let mean = errors.iter().sum::<f64>() / errors.len() as f64;
    let rmse =
        (errors.iter().map(|e| (e - mean).powi(2)).sum::<f64>() / errors.len() as f64).sqrt();
    let max = errors.iter().map(|e| (e - mean).abs()).fold(0.0, f64::max);
    (rmse, max)
}

fn main() {
    let holdout = std::env::args().nth(1).as_deref() == Some("holdout");
    // Match the public operation's documented 384-point input preprocessing,
    // then evaluate independently at 2048 points between those fit points.
    let frequencies: Vec<_> = (0..384)
        .map(|i| {
            (20.0_f32.ln() + (20000.0_f32.ln() - 20.0_f32.ln()) * i as f32 / 383.0).exp() as f64
        })
        .collect();
    let measurement = [(20.0, 0.0), (20000.0, 0.0)];
    println!("case\ttarget\tbands\trmse_db\tmax_error_db\tms");
    for case in 0..16 {
        let seed = if holdout { case + 100 } else { case };
        let target = fixture(seed, &frequencies);
        let mean = target.iter().map(|p| p.1).sum::<f64>() / target.len() as f64;
        let treble = target.partition_point(|p| p.0 < 18500.0);
        let reference: Vec<_> = target
            .iter()
            .enumerate()
            .map(|(i, &(f, db))| {
                let weight = if i >= treble {
                    (std::f64::consts::FRAC_PI_2 * (i - treble) as f64
                        / (target.len() - treble - 1) as f64)
                        .cos()
                } else {
                    1.0
                };
                (f, (db - mean) * weight)
            })
            .collect();
        for (name, id, bands) in [
            ("desktop3", None, 3),
            ("desktop5", None, 5),
            ("desktop10", None, 10),
            ("fiio", Some((0x2972, 0x0102)), 5),
            ("walkplay", Some((0x35d8, 0x011d)), 5),
            ("moondrop", Some((0x3302, 0x43e6)), 5),
        ] {
            let profile = id.map(|(vid, pid)| get_supported_device(vid, pid).unwrap());
            let caps = profile.map_or(&DESKTOP_DAC_CAPS, |p| &p.caps);
            let target_device = profile.map_or_else(
                || AutoEqTarget::capabilities(Some(caps)),
                |p| AutoEqTarget::device(caps, p.protocol),
            );
            let started = Instant::now();
            let peq = run_autoeq_with_target(
                &measurement,
                &target,
                bands,
                0,
                "none",
                caps.dsp_sample_rate as f32,
                target_device,
            )
            .unwrap();
            let ms = started.elapsed().as_secs_f64() * 1000.0;
            let (rmse, max) = scores(
                &peq.filters,
                caps.dsp_sample_rate,
                profile.and_then(|p| p.protocol.eq),
                &reference,
            );
            println!("{seed}\t{name}\t{bands}\t{rmse:.9}\t{max:.9}\t{ms:.3}");
        }
    }
}
