use super::*;
use crate::eq::iir_math::accumulate_response_values_cos_for_model;

fn problem<'a>(
    types: &'a [FilterType],
    bounds: &'a [(f64, f64)],
    target: &'a [f32; K],
    fs: f64,
    model: EqResponseModel,
) -> Problem<'a> {
    let f = super::super::generate_log_spaced_freqs();
    Problem {
        types,
        bounds,
        target,
        sample_rate: fs,
        model,
        phi: std::array::from_fn(|k| (std::f64::consts::PI * f[k] as f64 / fs).sin().powi(2)),
        sin: std::array::from_fn(|k| (std::f64::consts::TAU * f[k] as f64 / fs).sin()),
    }
}

#[test]
fn stable_forward_and_jacobian_match_independent_model_at_domain_edges() {
    let f = super::super::generate_log_spaced_freqs();
    let target = [0.0; K];
    let bounds = [(0.0, 20.0), (-15.0, 15.0), (-5.0, 5.0)];
    for fs in [40_000.0, 48_000.0, 96_000.0, 768_000.0] {
        let cos: Vec<_> = f
            .iter()
            .map(|&f| (std::f64::consts::TAU * f as f64 / fs).cos())
            .collect();
        for model in [
            EqResponseModel::CanonicalQ,
            EqResponseModel::MoondropShelfSlope,
        ] {
            for kind in [
                FilterType::Peak,
                FilterType::LowShelf,
                FilterType::HighShelf,
            ] {
                for (frequency, gain, q) in [
                    (20.0_f64, 6.0, 0.7_f64),
                    (31.0, -12.0, 0.4),
                    (1000.0, 8.0, 0.7),
                    (16_000.0, 3.0, 0.6),
                ] {
                    let types = [kind];
                    let p = problem(&types, &bounds, &target, fs, model);
                    let x = [frequency.ln(), gain / 10.0, q.ln()];
                    let actual = p.evaluate::<true>(&x);
                    let mut reference = [0.0; K];
                    accumulate_response_values_cos_for_model(
                        kind,
                        frequency,
                        gain,
                        q,
                        fs,
                        model,
                        &cos,
                        &mut reference,
                    )
                    .unwrap();
                    for (k, &reference) in reference.iter().enumerate() {
                        assert!(
                            (actual.residual[k] - actual.offset - reference as f64).abs() < 2e-4,
                            "{kind:?} {model:?} {fs}Hz {frequency}Hz point {k}"
                        );
                    }
                    for axis in 0..3 {
                        let h = 1e-5;
                        let mut plus = x;
                        plus[axis] += h;
                        let mut minus = x;
                        minus[axis] -= h;
                        let plus = p.evaluate::<false>(&plus);
                        let minus = p.evaluate::<false>(&minus);
                        for k in 0..K {
                            let numeric = (plus.residual[k] - minus.residual[k]) / (2.0 * h);
                            let analytic = actual.jacobian[axis][k];
                            assert!((analytic-numeric).abs()<2e-3*(1.0+numeric.abs()),
                                "{kind:?} {model:?} {fs}Hz {frequency}Hz axis {axis} point {k}: {analytic} != {numeric}");
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn high_q_low_frequency_is_finite_and_accurate() {
    let target = [0.0; K];
    let types = [FilterType::Peak];
    let bounds = [(0.0, 20.0), (-15.0, 15.0), (-5.0, 5.0)];
    for fs in [48_000.0, 96_000.0, 768_000.0] {
        let mut p = problem(&types, &bounds, &target, fs, EqResponseModel::CanonicalQ);
        let f = 20.0;
        p.phi[0] = (std::f64::consts::PI * f / fs).sin().powi(2);
        p.sin[0] = (std::f64::consts::TAU * f / fs).sin();
        for gain in [-16.0, 16.0] {
            let x = [f.ln(), gain / 10.0, 100.0_f64.ln()];
            let e = p.evaluate::<true>(&x);
            assert!((e.residual[0] - e.offset - gain).abs() < 1e-4);
            assert!(e.loss.is_finite());
            assert!(e.jacobian.iter().flatten().all(|v| v.is_finite()));
        }
    }
}

#[test]
fn accepted_loss_describes_returned_state_and_never_worsens_initialization() {
    let types = [FilterType::Peak, FilterType::LowShelf];
    let bounds = [
        (20.0_f64.ln(), 16000.0_f64.ln()),
        (-1.6, 1.6),
        (0.4_f64.ln(), 4.0_f64.ln()),
        (20.0_f64.ln(), 500.0_f64.ln()),
        (-1.6, 1.6),
        (0.4_f64.ln(), 0.7_f64.ln()),
    ];
    let target = std::array::from_fn(|k| (k as f32 * 0.03).sin() * 4.0);
    let p = problem(
        &types,
        &bounds,
        &target,
        96_000.0,
        EqResponseModel::CanonicalQ,
    );
    let initial = [
        800.0_f64.ln(),
        0.1,
        1.0_f64.ln(),
        80.0_f64.ln(),
        -0.1,
        0.7_f64.ln(),
    ];
    let initial_loss = p.evaluate::<false>(&initial).loss;
    for steps in [0, 1, 5, 80] {
        let mut x = initial;
        let (loss, offset) = p.solve(&mut x, steps);
        let actual = p.evaluate::<false>(&x);
        assert_eq!(loss, actual.loss);
        assert_eq!(offset, actual.offset);
        assert!(loss <= initial_loss);
        for (x, (lo, hi)) in x.iter().zip(&bounds) {
            assert!(x >= lo && x <= hi);
        }
    }
}

#[test]
fn fixed_parameters_and_redundant_bands_do_not_make_solver_singular() {
    let types = [FilterType::Peak; 32];
    let bounds = [(1000.0_f64.ln(), 1000.0_f64.ln()), (0.0, 0.0), (0.0, 0.0)].repeat(32);
    let target = [1.0; K];
    let p = problem(
        &types,
        &bounds,
        &target,
        96_000.0,
        EqResponseModel::CanonicalQ,
    );
    let mut x: Vec<_> = bounds.iter().map(|b| b.0).collect();
    let (loss, offset) = p.solve(&mut x, 80);
    assert!(loss < 1e-12);
    assert!((offset - 1.0).abs() < 1e-9);
}
