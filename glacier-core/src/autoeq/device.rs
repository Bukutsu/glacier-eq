//! Device realization and headroom policy, separate from the numerical solver.

use crate::device::{DeviceCapabilities, EqProtocol, Protocol};
use crate::eq::iir_math::{
    biquad_mag_squared_coeffs, compute_biquad_coeffs_for_model, eval_biquad_mag_squared_db,
    EqResponseModel,
};
use crate::eq::{Filter, PEQData};

use super::objective::Objective;
use super::K;

/// The limits and wire format of the target. Capabilities-only callers keep a
/// continuous gain/Q model; device callers also fit the protocol's DSP model
/// and publish parameters on its actual grids.
#[derive(Clone, Copy)]
pub struct AutoEqTarget<'a> {
    pub(super) caps: Option<&'a DeviceCapabilities>,
    pub(super) protocol: Option<&'a dyn EqProtocol>,
}

impl<'a> AutoEqTarget<'a> {
    pub fn capabilities(caps: Option<&'a DeviceCapabilities>) -> Self {
        Self {
            caps,
            protocol: None,
        }
    }

    pub fn device(caps: &'a DeviceCapabilities, protocol: &'a Protocol) -> Self {
        Self {
            caps: Some(caps),
            protocol: protocol.eq,
        }
    }

    pub(super) fn model(self) -> EqResponseModel {
        self.protocol
            .map_or(EqResponseModel::CanonicalQ, |p| p.response_model())
    }

    pub(super) fn realize(self, filters: &mut [Filter], fs: f64) -> Result<(), String> {
        let gain_range = self.caps.map_or((-16.0, 16.0), |c| c.band_gain_range);
        let q_range = self.caps.map_or((0.01, 100.0), |c| c.q_range);
        let freq_range = self.caps.map_or((20.0, 20_000.0), |c| {
            (c.freq_range.0 as f64, c.freq_range.1 as f64)
        });
        let gain_step = self.protocol.map(|p| {
            let encoding = p.gain_encoding();
            encoding
                .band_step_db
                .unwrap_or(1.0 / encoding.band_units_per_db)
        });
        let q_step = self.protocol.and_then(|p| p.q_step());
        for filter in filters {
            filter.freq = (filter.freq as f64).clamp(
                freq_range.0.max(20.0),
                freq_range.1.min((0.49 * fs).floor()),
            ) as u16;
            filter.gain = snap(filter.gain, gain_range, gain_step)?;
            filter.q = snap(filter.q, q_range, q_step)?;
            self.model()
                .validate_parameters(filter.filter_type, filter.gain, filter.q)?;
        }
        Ok(())
    }

    /// Put the loudest point of the realized EQ at 0 dBFS. Any lower preamp
    /// only costs loudness; any higher one clips.
    fn preamp(self, peak: f64) -> Option<f64> {
        let range = self.caps.map_or((f64::NEG_INFINITY, f64::INFINITY), |c| {
            (c.global_gain_range.0 as f64, c.global_gain_range.1 as f64)
        });
        let mut step = self.protocol.map(|p| p.gain_encoding().preamp_step_db);
        if self.caps.is_some_and(|c| c.integer_preamp) {
            step = Some(1.0);
        }
        // Rounding to nearest can remove headroom and needlessly shrink the EQ.
        // Always select attenuation on the safe side of the protocol grid.
        let mut value = (-peak).clamp(range.0, range.1);
        if let Some(step) = step {
            value = ((value / step) + 1e-10).floor() * step;
        }
        let encoded = |value| self.protocol.map_or(value, |p| p.realized_preamp(value));
        if encoded(value) + peak > 1e-7 {
            // Some devices accept tenths in the editor but store preamp in Q8.
            // One more advertised step covers that wire rounding, provided it
            // still lies inside the declared envelope.
            if let Some(step) = step {
                value = ((value / step).round() - 1.0) * step;
            }
        }
        (value >= range.0 && encoded(value) + peak <= 1e-7).then_some(value)
    }

    fn preflight(self, peq: &PEQData, fs: f64) -> Result<(), String> {
        if let Some(protocol) = self.protocol {
            for filter in &peq.filters {
                protocol.write_filter_packets(filter.index, filter, fs, peq.global_gain)?;
            }
        }
        Ok(())
    }

    /// Realize before measuring headroom. If preamp or fixed-point coefficient
    /// limits prevent a full correction, retain a feasible scaled correction.
    pub(super) fn finalize(
        self,
        filters: Vec<Filter>,
        fs: f64,
        grid: &SafetyGrid,
    ) -> Result<PEQData, String> {
        let evaluate = |scale: f64| -> Result<PEQData, String> {
            let mut filters = filters.clone();
            for filter in &mut filters {
                filter.gain *= scale;
            }
            self.realize(&mut filters, fs)?;
            let peak = grid.peak(&filters, fs, self)?;
            let global_gain = self
                .preamp(peak)
                .ok_or("Device preamp range cannot provide AutoEQ headroom")?;
            let peq = PEQData {
                filters,
                global_gain,
            };
            self.preflight(&peq, fs)?;
            Ok(peq)
        };
        if let Ok(peq) = evaluate(1.0) {
            return Ok(peq);
        }
        let mut best = evaluate(0.0)
            .map_err(|e| format!("AutoEQ has no feasible non-clipping device realization: {e}"))?;
        let (mut lo, mut hi) = (0.0, 1.0);
        for _ in 0..24 {
            let scale = (lo + hi) * 0.5;
            match evaluate(scale) {
                Ok(peq) => {
                    lo = scale;
                    best = peq;
                }
                Err(_) => hi = scale,
            }
        }
        Ok(best)
    }
}

fn snap(value: f64, range: (f64, f64), step: Option<f64>) -> Result<f64, String> {
    let Some(step) = step else {
        return Ok(value.clamp(range.0, range.1));
    };
    if !step.is_finite() || step <= 0.0 {
        return Err("Invalid protocol parameter precision".into());
    }
    let first = (range.0 / step - 1e-10).ceil();
    let last = (range.1 / step + 1e-10).floor();
    if first > last {
        return Err("Device parameter range has no representable protocol value".into());
    }
    Ok(((value / step).round().clamp(first, last) * step).clamp(range.0, range.1))
}

/// Fitting covers the audible band. Safety covers the entire digital band,
/// including DC and Nyquist. Cache this grid for every scale trial.
pub(super) struct SafetyGrid {
    cos: Vec<f64>,
}

impl SafetyGrid {
    pub(super) fn new(fs: f64) -> Self {
        let nyquist = fs * 0.5;
        let mut cos = Vec::with_capacity(8194);
        cos.push(1.0); // DC
        for i in 0..8192 {
            let frequency = (nyquist.ln() * i as f64 / 8191.0).exp();
            cos.push((std::f64::consts::TAU * frequency / fs).cos());
        }
        cos.push(-1.0); // exact Nyquist
        Self { cos }
    }

    pub(super) fn peak(
        &self,
        filters: &[Filter],
        fs: f64,
        target: AutoEqTarget<'_>,
    ) -> Result<f64, String> {
        let coefficients = response_coefficients(filters, fs, target)?;
        let at = |cos| -> f64 {
            coefficients
                .iter()
                .map(|&c| eval_biquad_mag_squared_db(c, cos) as f64)
                .sum()
        };
        let response: Vec<_> = self.cos.iter().map(|&cos| at(cos)).collect();
        if response.iter().any(|v| !v.is_finite()) {
            return Err("AutoEQ response produced non-finite values".into());
        }
        let mut peak = response.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        // Refine every sampled local maximum in cosine space. This catches
        // narrow peaks between grid points without making all fits use a huge
        // evaluation grid. Include the exact DC/Nyquist values above.
        for i in 1..response.len() - 1 {
            if response[i] > response[i - 1] && response[i] >= response[i + 1] {
                let (mut a, mut b) = (self.cos[i + 1], self.cos[i - 1]);
                let ratio = 0.618_033_988_749_894_9;
                let mut c = b - ratio * (b - a);
                let mut d = a + ratio * (b - a);
                let (mut fc, mut fd) = (at(c), at(d));
                for _ in 0..24 {
                    if fc > fd {
                        b = d;
                        d = c;
                        fd = fc;
                        c = b - ratio * (b - a);
                        fc = at(c);
                    } else {
                        a = c;
                        c = d;
                        fc = fd;
                        d = a + ratio * (b - a);
                        fd = at(d);
                    }
                }
                peak = peak.max(fc).max(fd);
            }
        }
        // Allow for f32 response accumulation and the finite peak refinement,
        // not for arbitrary input clipping. A neutral cascade needs no margin.
        Ok(if peak.abs() < 1e-9 { 0.0 } else { peak + 0.001 })
    }
}

pub(super) fn shape_loss(
    filters: &[Filter],
    fs: f64,
    target: AutoEqTarget<'_>,
    cos: &[f64],
    desired: &[f32; K],
    objective: &Objective,
) -> Result<f32, String> {
    let coefficients = response_coefficients(filters, fs, target)?;
    let error: [f64; K] = std::array::from_fn(|k| {
        coefficients
            .iter()
            .map(|&c| eval_biquad_mag_squared_db(c, cos[k]) as f64)
            .sum::<f64>()
            - desired[k] as f64
    });
    let loss = objective.loss(&error, filters.iter().map(|f| f.gain));
    if !loss.is_finite() {
        return Err("AutoEQ realized loss is non-finite".into());
    }
    Ok(loss as f32)
}

// Prepare the actual encoded cascade once, then reuse it for the dense grid,
// local peak refinement, and delivered-layout scoring.
type MagnitudeCoefficients = (f64, f64, f64, f64, f64, f64);

fn response_coefficients(
    filters: &[Filter],
    fs: f64,
    target: AutoEqTarget<'_>,
) -> Result<Vec<MagnitudeCoefficients>, String> {
    filters
        .iter()
        .filter(|f| f.enabled)
        .map(|filter| {
            let c = if let Some(protocol) = target.protocol {
                protocol.realized_biquad(filter, fs)?
            } else {
                compute_biquad_coeffs_for_model(
                    filter.filter_type,
                    filter.freq as f64,
                    filter.gain,
                    filter.q,
                    fs,
                    target.model(),
                )
            };
            let (b0, b1, b2, a0, a1, a2) = c;
            if [b0, b1, b2, a0, a1, a2].iter().any(|v| !v.is_finite())
                || a0 <= 0.0
                || (a2 / a0).abs() >= 1.0
                || 1.0 + a1 / a0 + a2 / a0 <= 0.0
                || 1.0 - a1 / a0 + a2 / a0 <= 0.0
            {
                return Err("AutoEQ encoded biquad is non-finite or unstable".into());
            }
            Ok(biquad_mag_squared_coeffs(c))
        })
        .collect()
}
