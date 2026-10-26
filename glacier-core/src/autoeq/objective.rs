//! What a fit should minimize, shared by the solver and delivered-EQ scoring.
//!
//! The Harman listener-preference models score the error between 20 Hz (in-ear)
//! or 50 Hz (over-ear) and 10 kHz; measurements above that depend on insertion
//! depth and the coupler. So full weight covers 20 Hz–10 kHz and the treble
//! keeps a small weight that stops the fit from ignoring it altogether. The
//! common level stays free: the preamp sets it later.
//!
//! Many band sets draw the same shape. A small ridge on band gain picks the one
//! with the least boost and cut, which removes opposed band pairs and broad
//! cuts standing in for a level change. Those are inaudible in the shape but
//! cost headroom, and so loudness.

use super::K;

/// Full weight up to here (Hz).
const FULL_WEIGHT_HZ: f64 = 10_000.0;
/// Treble weight is reached here (Hz), after a raised-cosine transition.
const TREBLE_HZ: f64 = 16_000.0;
const TREBLE_WEIGHT: f64 = 0.1;
/// Penalty per (10 dB)^2 of band gain, relative to a mean-squared error in dB^2.
const GAIN_RIDGE: f64 = 0.03;

pub(super) struct Objective {
    /// Square roots of the normalized point weights.
    scale: [f64; K],
    /// Normalized point weights; they sum to one.
    weight: [f64; K],
}

impl Objective {
    pub fn new(f: &[f32; K]) -> Self {
        let raw: [f64; K] = std::array::from_fn(|k| {
            let f = f[k] as f64;
            if f <= FULL_WEIGHT_HZ {
                1.0
            } else if f >= TREBLE_HZ {
                TREBLE_WEIGHT
            } else {
                let t = (f / FULL_WEIGHT_HZ).ln() / (TREBLE_HZ / FULL_WEIGHT_HZ).ln();
                TREBLE_WEIGHT
                    + (1.0 - TREBLE_WEIGHT) * 0.5 * (1.0 + (std::f64::consts::PI * t).cos())
            }
        });
        let total: f64 = raw.iter().sum();
        let weight = raw.map(|w| w / total);
        Self {
            scale: weight.map(f64::sqrt),
            weight,
        }
    }

    pub fn ridge(&self) -> f64 {
        GAIN_RIDGE
    }

    /// Weighted, level-free rows of one error curve or one Jacobian column.
    /// The map is linear, so columns project exactly like the error.
    pub fn project(&self, v: &[f64; K], out: &mut [f64; K]) {
        let level: f64 = self.weight.iter().zip(v).map(|(w, v)| w * v).sum();
        for k in 0..K {
            out[k] = self.scale[k] * (v[k] - level);
        }
    }

    /// Loss of an error curve (EQ response minus desired correction, dB) and
    /// the band gains (dB) that drew it.
    pub fn loss(&self, error: &[f64; K], gains_db: impl Iterator<Item = f64>) -> f64 {
        let mut rows = [0.0; K];
        self.project(error, &mut rows);
        rows.iter().map(|v| v * v).sum::<f64>()
            + GAIN_RIDGE * gains_db.map(|g| (g / 10.0).powi(2)).sum::<f64>()
    }
}
