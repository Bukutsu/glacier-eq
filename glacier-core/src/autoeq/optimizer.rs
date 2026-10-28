//! Bounded, damped least squares for a cascade of parametric biquads.
//!
//! Parameters are log-frequency, gain in dB, and log-Q per band. The solver
//! owns the filter model and its derivatives; `Objective` decides how errors
//! are weighted and compared. A trial is accepted only after its actual loss
//! is evaluated.

use super::objective::Objective;
use super::{FilterType, Lim, K};
use crate::eq::iir_math::EqResponseModel;
use std::ops::{Add, Div, Mul, Neg, Sub};

/// Value and three local partials: log-frequency, gain, log-Q. Differentiating
/// coefficient construction once per band keeps the response and Jacobian on
/// the same equations, including the device's shelf convention.
#[derive(Clone, Copy)]
struct Jet {
    v: f64,
    d: [f64; 3],
}

impl Jet {
    fn constant(v: f64) -> Self {
        Self { v, d: [0.0; 3] }
    }
    fn variable(v: f64, axis: usize) -> Self {
        let mut d = [0.0; 3];
        d[axis] = 1.0;
        Self { v, d }
    }
    fn map(self, v: f64, slope: f64) -> Self {
        Self {
            v,
            d: self.d.map(|d| d * slope),
        }
    }
    fn exp(self) -> Self {
        let v = self.v.exp();
        self.map(v, v)
    }
    fn sin(self) -> Self {
        self.map(self.v.sin(), self.v.cos())
    }
    fn cos(self) -> Self {
        self.map(self.v.cos(), -self.v.sin())
    }
    fn sqrt(self) -> Self {
        let v = self.v.sqrt();
        self.map(v, 0.5 / v)
    }
}
impl Add for Jet {
    type Output = Self;
    fn add(self, rhs: Self) -> Self {
        Self {
            v: self.v + rhs.v,
            d: std::array::from_fn(|i| self.d[i] + rhs.d[i]),
        }
    }
}
impl Sub for Jet {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self {
        self + -rhs
    }
}
impl Neg for Jet {
    type Output = Self;
    fn neg(self) -> Self {
        self.map(-self.v, -1.0)
    }
}
// Product/quotient rules intentionally mix arithmetic operators.
#[allow(clippy::suspicious_arithmetic_impl)]
impl Mul for Jet {
    type Output = Self;
    fn mul(self, rhs: Self) -> Self {
        Self {
            v: self.v * rhs.v,
            d: std::array::from_fn(|i| self.d[i] * rhs.v + self.v * rhs.d[i]),
        }
    }
}
#[allow(clippy::suspicious_arithmetic_impl)]
impl Div for Jet {
    type Output = Self;
    fn div(self, rhs: Self) -> Self {
        let v = self.v / rhs.v;
        Self {
            v,
            d: std::array::from_fn(|i| (self.d[i] - v * rhs.d[i]) / rhs.v),
        }
    }
}
impl Mul<f64> for Jet {
    type Output = Self;
    fn mul(self, rhs: f64) -> Self {
        self.map(self.v * rhs, rhs)
    }
}
impl Add<f64> for Jet {
    type Output = Self;
    fn add(self, rhs: f64) -> Self {
        Self {
            v: self.v + rhs,
            ..self
        }
    }
}
impl Sub<f64> for Jet {
    type Output = Self;
    fn sub(self, rhs: f64) -> Self {
        self + -rhs
    }
}

fn coefficients(kind: FilterType, x: &[f64], fs: f64, model: EqResponseModel) -> [Jet; 6] {
    let omega = Jet::variable(x[0], 0).exp() * (std::f64::consts::TAU / fs);
    let a = (Jet::variable(x[1], 1) * (10.0 * std::f64::consts::LN_10 / 40.0)).exp();
    let q = Jet::variable(x[2], 2).exp();
    let c = omega.cos();
    let alpha = if model == EqResponseModel::MoondropShelfSlope && kind != FilterType::Peak {
        omega.sin()
            * 0.5
            * ((a + Jet::constant(1.0) / a) * (Jet::constant(1.0) / q - 1.0) + 2.0).sqrt()
    } else {
        omega.sin() / (q * 2.0)
    };
    let one = Jet::constant(1.0);
    match kind {
        FilterType::Peak => [
            one + alpha * a,
            c * -2.0,
            one - alpha * a,
            one + alpha / a,
            c * -2.0,
            one - alpha / a,
        ],
        FilterType::LowShelf => {
            let p = a + 1.0;
            let m = a - 1.0;
            let s = a.sqrt() * alpha * 2.0;
            [
                a * (p - m * c + s),
                a * (m - p * c) * 2.0,
                a * (p - m * c - s),
                p + m * c + s,
                (m + p * c) * -2.0,
                p + m * c - s,
            ]
        }
        FilterType::HighShelf => {
            let p = a + 1.0;
            let m = a - 1.0;
            let s = a.sqrt() * alpha * 2.0;
            [
                a * (p + m * c + s),
                a * (m + p * c) * -2.0,
                a * (p + m * c - s),
                p - m * c + s,
                (m - p * c) * 2.0,
                p - m * c - s,
            ]
        }
        _ => unreachable!("AutoEQ only fits peaks and shelves"),
    }
}

pub(super) struct Problem<'a> {
    pub types: &'a [FilterType],
    pub phi: [f64; K],
    pub sin: [f64; K],
    pub target: &'a [f32; K],
    pub sample_rate: f64,
    pub model: EqResponseModel,
    pub bounds: &'a [(f64, f64)],
    pub objective: &'a Objective,
}

struct Evaluation {
    residual: [f64; K],
    jacobian: Vec<[f64; K]>,
    loss: f64,
}

/// Power ratios multiplied before one logarithm. Bounded gains keep eight
/// bands far inside f64 range, and it saves most per-band logarithms.
const BANDS_PER_LOG: usize = 8;
const DB_POWER: f64 = 10.0 / std::f64::consts::LN_10;

impl Problem<'_> {
    /// EQ response minus the target (dB) and, optionally, its partial
    /// derivatives for every parameter.
    fn error<const JACOBIAN: bool>(&self, x: &[f64]) -> ([f64; K], Vec<[f64; K]>) {
        let mut error: [f64; K] = std::array::from_fn(|k| -self.target[k] as f64);
        let mut ratio = [1.0; K];
        let mut columns = if JACOBIAN {
            vec![[0.0; K]; x.len()]
        } else {
            Vec::new()
        };
        for (n, &kind) in self.types.iter().enumerate() {
            let [b0, b1, b2, a0, a1, a2] =
                coefficients(kind, &x[3 * n..3 * n + 3], self.sample_rate, self.model);
            // Evaluate squared magnitude as a sum of squares, NOT a quadratic
            // with large cancelling terms (especially important near DC).
            let br0 = b0 + b1 + b2;
            let br1 = (b0 + b2) * -2.0;
            let bi = b0 - b2;
            let ar0 = a0 + a1 + a2;
            let ar1 = (a0 + a2) * -2.0;
            let ai = a0 - a2;
            for k in 0..K {
                let phi = self.phi[k];
                let sin = self.sin[k];
                // Plain values first; derivatives only when requested.
                let br = br0.v + br1.v * phi;
                let ar = ar0.v + ar1.v * phi;
                let b_im = bi.v * sin;
                let a_im = ai.v * sin;
                let num = br * br + b_im * b_im;
                let den = ar * ar + a_im * a_im;
                ratio[k] *= num / den;
                if JACOBIAN {
                    for axis in 0..3 {
                        let d_br = br0.d[axis] + br1.d[axis] * phi;
                        let d_ar = ar0.d[axis] + ar1.d[axis] * phi;
                        columns[3 * n + axis][k] = 2.0
                            * DB_POWER
                            * ((br * d_br + b_im * bi.d[axis] * sin) / num
                                - (ar * d_ar + a_im * ai.d[axis] * sin) / den);
                    }
                }
            }
            if (n + 1) % BANDS_PER_LOG == 0 || n + 1 == self.types.len() {
                for k in 0..K {
                    error[k] += DB_POWER * ratio[k].ln();
                    ratio[k] = 1.0;
                }
            }
        }
        (error, columns)
    }

    fn evaluate<const JACOBIAN: bool>(&self, x: &[f64]) -> Evaluation {
        let (error, columns) = self.error::<JACOBIAN>(x);
        let mut e = Evaluation {
            residual: [0.0; K],
            jacobian: vec![[0.0; K]; columns.len()],
            loss: 0.0,
        };
        self.objective.project(&error, &mut e.residual);
        for (column, out) in columns.iter().zip(&mut e.jacobian) {
            self.objective.project(column, out);
        }
        let gains = x.iter().skip(1).step_by(3);
        e.loss = e.residual.iter().map(|v| v * v).sum::<f64>()
            + self.objective.ridge() * gains.map(|g| g * g).sum::<f64>();
        e
    }

    pub fn solve(&self, x: &mut [f64], steps: usize) -> f64 {
        let p = x.len();
        let mut current = self.evaluate::<true>(x);
        let mut damping = 1e-2;
        let mut trial = x.to_vec();
        let mut matrix = vec![0.0; p * p];
        let mut rhs = vec![0.0; p];
        for _ in 0..steps {
            if !current.loss.is_finite() || current.loss < 1e-12 {
                break;
            }
            for i in 0..p {
                let ji = &current.jacobian[i];
                rhs[i] = -dot(ji, &current.residual);
                for j in 0..=i {
                    let v = dot(ji, &current.jacobian[j]);
                    matrix[i * p + j] = v;
                    matrix[j * p + i] = v;
                }
                // Gain parameters are dB / 10, so the ridge applies directly.
                if i % 3 == 1 {
                    rhs[i] -= self.objective.ridge() * x[i];
                    matrix[i * p + i] += self.objective.ridge();
                }
            }
            // Freeze coordinates whose descent points out of the feasible set.
            // Without this active-set projection the coupled solve repeatedly
            // pushes saturated bands outward and stalls the remaining bands.
            for i in 0..p {
                if (x[i] <= self.bounds[i].0 + 1e-10 && rhs[i] < 0.0)
                    || (x[i] >= self.bounds[i].1 - 1e-10 && rhs[i] > 0.0)
                    || self.bounds[i].0 == self.bounds[i].1
                {
                    for j in 0..p {
                        matrix[i * p + j] = 0.0;
                        matrix[j * p + i] = 0.0;
                    }
                    matrix[i * p + i] = 1.0;
                    rhs[i] = 0.0;
                }
            }
            if rhs.iter().all(|v| v.abs() < 1e-8) {
                break;
            }
            let mut accepted = false;
            for _ in 0..12 {
                let mut a = matrix.clone();
                let mut step = rhs.clone();
                for i in 0..p {
                    a[i * p + i] += damping * matrix[i * p + i].max(1e-6);
                }
                if !cholesky_solve(&mut a, &mut step) {
                    damping *= 10.0;
                    continue;
                }
                let mut movement: f64 = 0.0;
                for i in 0..p {
                    let max_step = if i % 3 == 1 { 0.3 } else { 0.5 };
                    trial[i] = (x[i] + step[i].clamp(-max_step, max_step))
                        .clamp(self.bounds[i].0, self.bounds[i].1);
                    movement = movement.max((trial[i] - x[i]).abs());
                }
                if movement < 1e-8 {
                    return current.loss;
                }
                let candidate = self.evaluate::<false>(&trial);
                if candidate.loss.is_finite() && candidate.loss < current.loss {
                    let improvement = current.loss - candidate.loss;
                    x.copy_from_slice(&trial);
                    current = self.evaluate::<true>(x);
                    damping = (damping * 0.3).max(1e-8);
                    accepted = true;
                    if improvement < 1e-7 * (1.0 + current.loss) {
                        return current.loss;
                    }
                    break;
                }
                damping *= 10.0;
            }
            if !accepted {
                break;
            }
        }
        current.loss
    }
}

// The 4-wide loop below covers every point only when K is a multiple of 4.
const _: () = assert!(K.is_multiple_of(4));

fn dot(a: &[f64; K], b: &[f64; K]) -> f64 {
    let mut sums = [0.0; 4];
    for (a, b) in a.as_chunks::<4>().0.iter().zip(b.as_chunks::<4>().0) {
        for i in 0..4 {
            sums[i] += a[i] * b[i];
        }
    }
    sums.into_iter().sum()
}

/// In-place Cholesky factorization and triangular solves. Damping makes the
/// normal equations positive definite even for redundant/zero-gain bands.
fn cholesky_solve(a: &mut [f64], b: &mut [f64]) -> bool {
    let p = b.len();
    for i in 0..p {
        for j in 0..=i {
            let mut v = a[i * p + j];
            for k in 0..j {
                v -= a[i * p + k] * a[j * p + k];
            }
            if i == j {
                if !v.is_finite() || v <= 0.0 {
                    return false;
                }
                a[i * p + j] = v.sqrt();
            } else {
                a[i * p + j] = v / a[j * p + j];
            }
        }
    }
    for i in 0..p {
        for j in 0..i {
            b[i] -= a[i * p + j] * b[j];
        }
        b[i] /= a[i * p + i];
    }
    for i in (0..p).rev() {
        for j in i + 1..p {
            b[i] -= a[j * p + i] * b[j];
        }
        b[i] /= a[i * p + i];
    }
    b.iter().all(|v| v.is_finite())
}

/// One candidate band and its explicit feasible set. The solver owns no device
/// policy: callers choose filter kinds, bounds, and initialization.
pub(super) struct Band {
    pub kind: FilterType,
    pub frequency: f64,
    pub gain: f64,
    pub q: f64,
    pub frequency_bounds: Lim,
    pub gain_bounds: Lim,
    pub q_bounds: Lim,
}

pub(super) fn fit(
    bands: &mut [Band],
    steps: usize,
    f: &[f32; K],
    r: &[f32; K],
    fs: f64,
    model: EqResponseModel,
    objective: &Objective,
) -> f64 {
    let mut x = Vec::with_capacity(3 * bands.len());
    let mut bounds = Vec::with_capacity(3 * bands.len());
    let types: Vec<_> = bands.iter().map(|band| band.kind).collect();
    for band in bands.iter() {
        let limits = [
            (
                (band.frequency_bounds.lo as f64).ln(),
                (band.frequency_bounds.hi as f64).ln(),
            ),
            (
                band.gain_bounds.lo as f64 / 10.0,
                band.gain_bounds.hi as f64 / 10.0,
            ),
            (
                (band.q_bounds.lo as f64).ln(),
                (band.q_bounds.hi as f64).ln(),
            ),
        ];
        let values = [band.frequency.ln(), band.gain / 10.0, band.q.ln()];
        for j in 0..3 {
            bounds.push(limits[j]);
            x.push(values[j].clamp(limits[j].0, limits[j].1));
        }
    }
    let problem = Problem {
        types: &types,
        phi: std::array::from_fn(|k| (std::f64::consts::PI * f[k] as f64 / fs).sin().powi(2)),
        sin: std::array::from_fn(|k| (std::f64::consts::TAU * f[k] as f64 / fs).sin()),
        target: r,
        sample_rate: fs,
        model,
        bounds: &bounds,
        objective,
    };
    let loss = problem.solve(&mut x, steps);
    for (i, band) in bands.iter_mut().enumerate() {
        band.frequency = x[3 * i].exp();
        band.gain = 10.0 * x[3 * i + 1];
        band.q = x[3 * i + 2].exp();
    }
    loss
}
