//! Real-headphone AutoEQ benchmark: Harman predicted listener preference and
//! loudness, over a folder of measurements.
//!
//! cargo run --release -p glacier-core --example autoeq_preference -- \
//!     <measurement dir> <target.csv> <ie|oe> <bands> <none|ie|oe> [vid:pid]
//!
//! Measurements and targets come from the AutoEq repository, e.g.
//! measurements/oratory1990/data/in-ear and "targets/Harman in-ear 2019.csv".
//! Set EQ_DIR to a folder of "<name>.txt" parametric EQs (AutoEq format) to
//! score another tool's output instead of fitting.
//!
//! Scores use the Harman in-ear and over-ear preference models as AutoEq
//! implements them (frequency_response.py, harman_*_preference_score), on the
//! raw measurement plus the delivered EQ. Loudness is the preamp plus the mean
//! EQ gain over 250 Hz–4 kHz, where most music and speech energy sits.
use glacier_core::autoeq::{
    parse_autoeq_text, parse_curve_text, run_autoeq_with_target, AutoEqTarget,
};
use glacier_core::device::capabilities::DESKTOP_DAC_CAPS;
use glacier_core::device::{get_supported_device, EqProtocol};
use glacier_core::eq::{iir_math::compute_biquad_coeffs, PEQData};
use std::{fs, path::PathBuf, time::Instant};

// Frequency grids of the Harman models, from AutoEq's constants.py.
const OVER_EAR_HZ: [f64; 121] = [
    20.0, 21.0, 22.0, 24.0, 25.0, 27.0, 28.0, 30.0, 32.0, 34.0, 36.0, 38.0, 40.0, 43.0, 45.0, 48.0,
    50.0, 53.0, 56.0, 60.0, 63.0, 67.0, 71.0, 75.0, 80.0, 85.0, 90.0, 95.0, 100.0, 106.0, 112.0,
    118.0, 125.0, 132.0, 140.0, 150.0, 160.0, 170.0, 180.0, 190.0, 200.0, 212.0, 224.0, 236.0,
    250.0, 265.0, 280.0, 300.0, 315.0, 335.0, 355.0, 375.0, 400.0, 425.0, 450.0, 475.0, 500.0,
    530.0, 560.0, 600.0, 630.0, 670.0, 710.0, 750.0, 800.0, 850.0, 900.0, 950.0, 1000.0, 1060.0,
    1120.0, 1180.0, 1250.0, 1320.0, 1400.0, 1500.0, 1600.0, 1700.0, 1800.0, 1900.0, 2000.0, 2120.0,
    2240.0, 2360.0, 2500.0, 2650.0, 2800.0, 3000.0, 3150.0, 3350.0, 3550.0, 3750.0, 4000.0, 4250.0,
    4500.0, 4750.0, 5000.0, 5300.0, 5600.0, 6000.0, 6300.0, 6700.0, 7100.0, 7500.0, 8000.0, 8500.0,
    9000.0, 9500.0, 10000.0, 10600.0, 11200.0, 11800.0, 12500.0, 13200.0, 14000.0, 15000.0,
    16000.0, 17000.0, 18000.0, 19000.0, 20000.0,
];
const IN_EAR_HZ: [f64; 121] = [
    20.0, 21.2, 22.4, 23.6, 25.0, 26.5, 28.0, 30.0, 31.5, 33.5, 35.5, 37.5, 40.0, 42.5, 45.0, 47.5,
    50.0, 53.0, 56.0, 60.0, 63.0, 67.0, 71.0, 75.0, 80.0, 85.0, 90.0, 95.0, 100.0, 106.0, 112.0,
    118.0, 125.0, 132.0, 140.0, 150.0, 160.0, 170.0, 180.0, 190.0, 200.0, 212.0, 224.0, 236.0,
    250.0, 265.0, 280.0, 300.0, 315.0, 335.0, 355.0, 375.0, 400.0, 425.0, 450.0, 475.0, 500.0,
    530.0, 560.0, 600.0, 630.0, 670.0, 710.0, 750.0, 800.0, 850.0, 900.0, 950.0, 1000.0, 1060.0,
    1120.0, 1180.0, 1250.0, 1320.0, 1400.0, 1500.0, 1600.0, 1700.0, 1800.0, 1900.0, 2000.0, 2120.0,
    2240.0, 2360.0, 2500.0, 2650.0, 2800.0, 3000.0, 3150.0, 3350.0, 3550.0, 3750.0, 4000.0, 4250.0,
    4500.0, 4750.0, 5000.0, 5300.0, 5600.0, 6000.0, 6300.0, 6700.0, 7100.0, 7500.0, 8000.0, 8500.0,
    9000.0, 9500.0, 10000.0, 10600.0, 11200.0, 11800.0, 12500.0, 13200.0, 14000.0, 15000.0,
    16000.0, 17000.0, 18000.0, 19000.0, 20000.0,
];

struct Row {
    score: f64,
    loudness: f64,
    ms: f64,
}

fn eq_db(peq: &PEQData, f: f64, fs: f64, protocol: Option<&dyn EqProtocol>) -> f64 {
    let w = std::f64::consts::TAU * f / fs;
    let response: f64 = peq
        .filters
        .iter()
        .filter(|band| band.enabled)
        .map(|band| {
            let (b0, b1, b2, a0, a1, a2) = protocol.map_or_else(
                || compute_biquad_coeffs(band, fs),
                |p| p.realized_biquad(band, fs).unwrap(),
            );
            let rb = b0 + b1 * w.cos() + b2 * (2.0 * w).cos();
            let ib = -b1 * w.sin() - b2 * (2.0 * w).sin();
            let ra = a0 + a1 * w.cos() + a2 * (2.0 * w).cos();
            let ia = -a1 * w.sin() - a2 * (2.0 * w).sin();
            10.0 * ((rb * rb + ib * ib) / (ra * ra + ia * ia)).log10()
        })
        .sum();
    response + peq.global_gain
}

fn interpolate(points: &[(f64, f64)], f: f64) -> f64 {
    let i = points
        .partition_point(|p| p.0 < f)
        .clamp(1, points.len() - 1);
    let ((f0, y0), (f1, y1)) = (points[i - 1], points[i]);
    y0 + ((f / f0).ln() / (f1 / f0).ln()).clamp(0.0, 1.0) * (y1 - y0)
}

/// Sample standard deviation and slope of a regression on ln(frequency).
fn spread_and_slope(x: &[f64], y: &[f64]) -> (f64, f64) {
    let n = y.len() as f64;
    let my = y.iter().sum::<f64>() / n;
    let sd = (y.iter().map(|v| (v - my).powi(2)).sum::<f64>() / (n - 1.0)).sqrt();
    let lx: Vec<f64> = x.iter().map(|v| v.ln()).collect();
    let mx = lx.iter().sum::<f64>() / n;
    let covariance: f64 = lx.iter().zip(y).map(|(a, b)| (a - mx) * (b - my)).sum();
    let variance: f64 = lx.iter().map(|a| (a - mx).powi(2)).sum();
    (sd, covariance / variance)
}

fn preference(in_ear: bool, error: impl Fn(f64) -> f64) -> f64 {
    let (grid, low) = if in_ear {
        (&IN_EAR_HZ, 20.0)
    } else {
        (&OVER_EAR_HZ, 50.0)
    };
    let (x, y): (Vec<f64>, Vec<f64>) = grid
        .iter()
        .filter(|f| (low..=10_000.0).contains(*f))
        .map(|&f| (f, error(f)))
        .unzip();
    let (sd, slope) = spread_and_slope(&x, &y);
    if !in_ear {
        return 114.490443008238 - 12.62 * sd - 15.5163857197367 * slope.abs();
    }
    let at_500 = error(500.0);
    let deviations: Vec<f64> = grid
        .iter()
        .filter(|f| (40.0..=10_000.0).contains(*f))
        .map(|&f| (error(f) - at_500).abs())
        .collect();
    let mean_deviation = deviations.iter().sum::<f64>() / deviations.len() as f64;
    100.0795 - 8.5 * sd - 6.796 * slope.abs() - 3.475 * mean_deviation
}

fn percentile(values: &mut [f64], p: f64) -> f64 {
    values.sort_by(f64::total_cmp);
    values[((values.len() - 1) as f64 * p) as usize]
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let [_, dir, target, kind, bands, smoothing, rest @ ..] = args.as_slice() else {
        panic!("usage: <measurement dir> <target.csv> <ie|oe> <bands> <none|ie|oe> [vid:pid]");
    };
    let in_ear = kind == "ie";
    let profile = rest.first().map(|id| {
        let (vid, pid) = id.split_once(':').expect("device as vid:pid in hex");
        let parse = |v| u16::from_str_radix(v, 16).expect("hex id");
        get_supported_device(parse(vid), parse(pid)).expect("known device")
    });
    let caps = profile.map_or(&DESKTOP_DAC_CAPS, |p| &p.caps);
    let device = profile.map_or_else(
        || AutoEqTarget::capabilities(None),
        |p| AutoEqTarget::device(caps, p.protocol),
    );
    let protocol = profile.and_then(|p| p.protocol.eq);
    let fs = if profile.is_some() {
        caps.dsp_sample_rate
    } else {
        48_000.0
    };
    let bands: usize = bands.parse().expect("band count");
    let bands = profile.map_or(bands, |p| bands.min(p.caps.num_bands));
    let external = std::env::var("EQ_DIR").ok();
    let target = parse_curve_text(&fs::read_to_string(target).unwrap()).unwrap();
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|x| x == "csv"))
        .collect();
    files.sort();

    let threads = std::thread::available_parallelism().map_or(1, |n| n.get());
    let fit = |path: &PathBuf| -> Option<Row> {
        let measurement = parse_curve_text(&fs::read_to_string(path).ok()?).ok()?;
        let name = path.file_stem()?.to_string_lossy();
        let started = Instant::now();
        let peq = match &external {
            Some(dir) => {
                parse_autoeq_text(&fs::read_to_string(format!("{dir}/{name}.txt")).ok()?)
                    .ok()?
                    .0
            }
            None => run_autoeq_with_target(
                &measurement,
                &target,
                bands,
                0,
                smoothing,
                fs as f32,
                device,
            )
            .map_err(|e| eprintln!("{name}: {e}"))
            .ok()?,
        };
        let ms = started.elapsed().as_secs_f64() * 1e3;
        let score = preference(in_ear, |f| {
            interpolate(&measurement, f) + eq_db(&peq, f, fs, protocol) - interpolate(&target, f)
        });
        let loudness = (0..200)
            .map(|i| eq_db(&peq, 250.0 * 16f64.powf(i as f64 / 199.0), fs, protocol))
            .sum::<f64>()
            / 200.0;
        Some(Row {
            score,
            loudness,
            ms,
        })
    };
    let rows: Vec<Row> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..threads)
            .map(|t| {
                let (files, fit) = (&files, &fit);
                scope.spawn(move || {
                    files
                        .iter()
                        .skip(t)
                        .step_by(threads)
                        .filter_map(fit)
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().unwrap())
            .collect()
    });

    let n = rows.len() as f64;
    let mut scores: Vec<f64> = rows.iter().map(|r| r.score).collect();
    let mut loudness: Vec<f64> = rows.iter().map(|r| r.loudness).collect();
    println!(
        "N={} preference mean {:.2} p10 {:.1} | loudness mean {:.2} p10 {:.2} min {:.2} dB | {:.1} ms/fit on {threads} threads",
        rows.len(),
        scores.iter().sum::<f64>() / n,
        percentile(&mut scores, 0.1),
        loudness.iter().sum::<f64>() / n,
        percentile(&mut loudness, 0.1),
        percentile(&mut loudness, 0.0),
        rows.iter().map(|r| r.ms).sum::<f64>() / n,
    );
}
