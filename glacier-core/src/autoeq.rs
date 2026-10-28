// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::{Filter, FilterType, PEQData};

pub const MAX_FILTERS: usize = 32;

fn strip_leading_bom<'a>(text: &'a str, label: &str) -> Result<&'a str, String> {
    let Some(without_bom) = text.strip_prefix('\u{feff}') else {
        return Ok(text);
    };
    if without_bom.starts_with('\u{feff}') {
        return Err(format!("{label} contains multiple UTF-8 BOM markers"));
    }
    Ok(without_bom)
}

/// Parses frequency/dB curves using the same rules as the frontend importer.
pub fn parse_curve_text(text: &str) -> Result<Vec<(f64, f64)>, String> {
    if text.len() > 1 << 20 || text.split('\n').count() > 4096 {
        return Err("Curve input exceeds maximum size".into());
    }
    let text = strip_leading_bom(text, "Curve input")?;
    let mut points = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
            continue;
        }
        let mut columns = line
            .split([',', '\t', ';', ' '])
            .filter(|column| !column.is_empty());
        let Some(frequency) = columns.next().and_then(|value| value.parse::<f64>().ok()) else {
            continue;
        };
        let Some(db) = columns.next().and_then(|value| value.parse::<f64>().ok()) else {
            continue;
        };
        if frequency.is_finite() && db.is_finite() && (20.0..=20_000.0).contains(&frequency) {
            points.push((frequency, db));
        }
    }
    normalize_curve_points(points)
}

const MAX_CURVE_POINTS: usize = 100_000;

fn normalize_curve_points(mut points: Vec<(f64, f64)>) -> Result<Vec<(f64, f64)>, String> {
    if points.len() > MAX_CURVE_POINTS {
        return Err("Curve exceeds maximum point count (100000)".into());
    }
    points.retain(|(frequency, db)| {
        frequency.is_finite() && db.is_finite() && (20.0..=20_000.0).contains(frequency)
    });
    points.sort_by(|a, b| a.0.total_cmp(&b.0));
    if points.len() < 2 {
        return Err("Need at least 2 valid frequency,dB points.".into());
    }
    let reference = interpolate_point(&points, 1000.0);
    if !reference.is_finite() {
        return Err("Curve normalization produced non-finite dB values".into());
    }
    for point in &mut points {
        point.1 -= reference;
        if !point.1.is_finite() {
            return Err("Curve normalization produced non-finite dB values".into());
        }
    }
    Ok(points)
}

fn interpolate_point(points: &[(f64, f64)], frequency: f64) -> f64 {
    if frequency <= points[0].0 {
        return points[0].1;
    }
    if frequency >= points[points.len() - 1].0 {
        return points[points.len() - 1].1;
    }
    let high = points.partition_point(|point| point.0 < frequency);
    let low = high - 1;
    let span = points[high].0.log10() - points[low].0.log10();
    if span <= 0.0 {
        return points[low].1;
    }
    let ratio = (frequency.log10() - points[low].0.log10()) / span;
    points[low].1 + (points[high].1 - points[low].1) * ratio
}

pub fn parse_autoeq_text(text: &str) -> Result<(PEQData, Option<String>, Vec<String>), String> {
    // CPU-DoS guard: reject absurdly large inputs before touching them.
    if text.len() > 1 << 20 {
        return Err("AutoEQ input exceeds maximum size (1 MiB)".into());
    }
    // A UTF-8 BOM is metadata, not part of the first directive. Strip one
    // before both line parsing and header-name extraction; repeated markers
    // are malformed rather than silently changing the first field.
    let text = strip_leading_bom(text, "AutoEQ input")?;
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() > 4096 {
        return Err("AutoEQ input exceeds maximum line count (4096)".into());
    }
    let mut filters: std::collections::BTreeMap<usize, Filter> = std::collections::BTreeMap::new();
    let mut preamp: f64 = 0.0;
    let mut preamp_seen = false;
    let mut parsed_count: usize = 0;
    let mut warnings: Vec<String> = Vec::new();

    let headphone_name = extract_name_from_comments(text);
    let mut next_sequential_idx = 0;

    for (line_idx, line) in lines.iter().enumerate() {
        let line_num = line_idx + 1;
        let mut line = line.trim();

        // Strip inline comments before parsing parameters
        if let Some((before, _)) = line.split_once('#') {
            line = before.trim();
        }
        if let Some((before, _)) = line.split_once("//") {
            line = before.trim();
        }
        if let Some((before, _)) = line.split_once(';') {
            line = before.trim();
        }

        if line.is_empty() {
            continue;
        }

        if line.to_lowercase().starts_with("preamp") {
            if let Some(m) = extract_number(line).filter(|value| value.is_finite()) {
                // Preamp is unbounded here, will be clamped later
                preamp = m;
                preamp_seen = true;
            } else {
                warnings.push(format!("Line {}: Failed to parse preamp value", line_num));
            }
            continue;
        }

        if line.to_lowercase().contains("filter") {
            let parsed = match parse_filter_line(line) {
                Ok(parsed) => parsed,
                Err(error) => {
                    warnings.push(format!("Line {line_num}: Failed to parse filter: {error}"));
                    continue;
                }
            };
            if let Some(warning) = parsed.warning {
                warnings.push(format!("Line {line_num}: {warning}"));
            }
            let idx = parsed.index.unwrap_or_else(|| {
                // Explicit indexes can appear out of order; never let a
                // sequential fill clobber one already parsed.
                while filters.contains_key(&next_sequential_idx) {
                    next_sequential_idx += 1;
                }
                let i = next_sequential_idx;
                next_sequential_idx += 1;
                i
            });

            // Reject out-of-range indexes before touching the sequential
            // cursor, or one malformed line poisons every unlabeled
            // filter after it.
            if idx >= MAX_FILTERS {
                warnings.push(format!(
                    "Line {}: Filter index {} exceeds maximum allowed bands ({MAX_FILTERS})",
                    line_num,
                    idx + 1
                ));
                continue;
            }

            if parsed.index.is_some() {
                next_sequential_idx = idx + 1;
            }
            // Clamp frequency into a cast-safe, sane range before `as u16`
            // to avoid the silent wraparound the old code had for huge/negative Fc.
            if !parsed.freq.is_finite() {
                warnings.push(format!(
                    "Line {line_num}: Invalid Fc value; skipping filter"
                ));
                continue;
            }
            let freq: u16 = if parsed.freq < 1.0
                || parsed.freq > 1_000_000.0
                || parsed.freq > u16::MAX as f64
            {
                warnings.push(format!(
                    "Line {}: Frequency {} Hz out of range [1, {}]; clamping",
                    line_num,
                    parsed.freq,
                    u16::MAX
                ));
                parsed.freq.clamp(1.0, u16::MAX as f64) as u16
            } else {
                parsed.freq as u16
            };
            if filters.contains_key(&idx) {
                warnings.push(format!(
                    "Line {}: Filter index {} duplicates an earlier filter; ignoring it",
                    line_num,
                    idx + 1
                ));
                continue;
            }
            filters.insert(
                idx,
                Filter {
                    index: idx as u8,
                    enabled: parsed.enabled,
                    freq,
                    gain: parsed.gain,
                    q: parsed.q,
                    filter_type: parsed.filter_type,
                },
            );
            parsed_count += 1;
        }
    }

    // An explicit "Preamp: 0 dB" line is a valid identity EQ; only reject
    // files with nothing recognizable at all.
    if parsed_count == 0 && !preamp_seen && preamp.abs() < 1e-5 {
        let mut error = "No valid filters or preamp found in AutoEQ text".to_string();
        if !warnings.is_empty() {
            error.push_str(": ");
            error.push_str(&warnings.join("; "));
        }
        return Err(error);
    }

    // Extract parsed filters, sort by frequency, and reindex sequentially
    let mut contiguous_filters: Vec<Filter> = filters.into_values().collect();
    contiguous_filters.sort_by_key(|f| f.freq);
    for (i, f) in contiguous_filters.iter_mut().enumerate() {
        f.index = i as u8;
    }

    Ok((
        PEQData {
            filters: contiguous_filters,
            global_gain: preamp,
        },
        headphone_name,
        warnings,
    ))
}

fn extract_name_from_comments(text: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        if let Some(stripped) = line.strip_prefix('#') {
            let content = stripped.trim();
            if content.is_empty() {
                continue;
            }

            // Check for explicit headers. Compare char-by-char, lowercasing
            // each source char on its own: Unicode lowercasing can change
            // byte and char counts ('İ' → "i̇"), so positions found in a
            // lowered copy are not valid indices into `content`.
            let header_name = |needle: &str| -> Option<String> {
                let chars: Vec<char> = content.chars().collect();
                let needle: Vec<char> = needle.chars().collect();
                let matches_at = |start: usize| {
                    // zip() truncates at the shorter side, so a content
                    // shorter than the needle would "match" its own prefix;
                    // require the full needle to fit first.
                    chars.len() - start >= needle.len()
                        && chars[start..]
                            .iter()
                            .zip(&needle)
                            .all(|(c, n)| c.to_lowercase().eq(n.to_lowercase()))
                };
                let start = (0..chars.len().saturating_sub(needle.len()) + 1)
                    .find(|&start| matches_at(start))?;
                let name: String = chars[start + needle.len()..].iter().collect();
                let name = name.trim();
                (!name.is_empty()).then(|| name.to_string())
            };
            if let Some(name) = header_name("graphiceq:") {
                return Some(name);
            }
            if let Some(name) = header_name("autoeq:") {
                return Some(name);
            }

            // Or if it's the first non-empty comment line and doesn't look like a URL or generic info
            let lowered = content.to_lowercase();
            if !lowered.contains("http")
                && !lowered.contains("squig.link")
                && !lowered.contains("equalizer")
                && !lowered.contains("preamp")
                && !lowered.contains("filter")
                && !lowered.contains("frequency")
                && !lowered.contains("response")
                && content.len() < 100
            {
                return Some(content.to_string());
            }
        } else if !line.is_empty() {
            // Stop searching once we hit actual non-comment content
            break;
        }
    }
    None
}

fn extract_number(s: &str) -> Option<f64> {
    let bytes = s.as_bytes();
    let start = s.find(|c: char| c == '-' || c == '+' || c == '.' || c.is_ascii_digit())?;
    let mut pos = start;
    if matches!(bytes[pos], b'-' | b'+') {
        pos += 1;
    }

    let mut digits = 0usize;
    let mut decimal = false;
    while let Some(byte) = bytes.get(pos) {
        match byte {
            b'0'..=b'9' => {
                digits += 1;
                pos += 1;
            }
            b'.' if !decimal => {
                decimal = true;
                pos += 1;
            }
            _ => break,
        }
    }
    if digits == 0 {
        return Some(f64::NAN);
    }

    if matches!(bytes.get(pos), Some(b'e' | b'E')) {
        pos += 1;
        if matches!(bytes.get(pos), Some(b'-' | b'+')) {
            pos += 1;
        }
        let exponent_start = pos;
        while matches!(bytes.get(pos), Some(b'0'..=b'9')) {
            pos += 1;
        }
        if pos == exponent_start {
            return Some(f64::NAN);
        }
    }

    s[start..pos]
        .parse()
        .ok()
        .map(|value: f64| if value.is_finite() { value } else { f64::NAN })
}

struct ParsedFilterLine {
    index: Option<usize>,
    enabled: bool,
    filter_type: FilterType,
    freq: f64,
    gain: f64,
    q: f64,
    warning: Option<&'static str>,
}

fn parse_filter_line(line: &str) -> Result<ParsedFilterLine, String> {
    let lower = line.to_ascii_lowercase();
    let rest = lower
        .strip_prefix("filter")
        .ok_or("Expected Filter directive")?
        .trim_start();
    let digit_count = rest.bytes().take_while(u8::is_ascii_digit).count();
    let index = if digit_count == 0 {
        None
    } else {
        let index = rest[..digit_count]
            .parse::<usize>()
            .ok()
            .and_then(|index| index.checked_sub(1))
            .ok_or("Filter index must be a positive integer")?;
        Some(index)
    };
    let rest = rest[digit_count..].trim_start();
    let rest = rest.strip_prefix(':').unwrap_or(rest).trim_start();
    let mut tokens = rest.split_whitespace();
    let enabled = match tokens.next() {
        Some("on") => true,
        Some("off") => false,
        _ => return Err("Expected ON or OFF".into()),
    };
    let token = tokens.next().ok_or("Missing filter type")?;
    let filter_type = match token {
        "pk" | "peq" | "peak" => FilterType::Peak,
        "lsc" | "lsq" | "ls" | "lowshelf" => FilterType::LowShelf,
        "hsc" | "hsq" | "hs" | "highshelf" => FilterType::HighShelf,
        "hp" | "hpq" | "hpf" | "highpass" => FilterType::HighPass,
        "lp" | "lpq" | "lpf" | "lowpass" => FilterType::LowPass,
        _ => return Err(format!("Unsupported filter type '{token}'")),
    };
    // Slope/corner-frequency shelf forms cannot be represented by simply
    // keeping Fc and Q. Do not silently discard a slope before Fc.
    if tokens.next() != Some("fc") {
        return Err("Expected Fc after filter type; slope forms are unsupported".into());
    }
    let freq = extract_number_after(rest, "Fc").ok_or("Missing Fc")?;
    let gain = if contains_token(rest, "gain") {
        extract_number_after(rest, "Gain").ok_or("Invalid Gain")?
    } else if matches!(filter_type, FilterType::HighPass | FilterType::LowPass) {
        0.0
    } else {
        return Err("Missing Gain".into());
    };
    let has_q = contains_token(rest, "q");
    let has_bw = contains_token(rest, "bw");
    if has_q && has_bw {
        return Err("Specify Q or BW Oct, not both".into());
    }
    let mut warning = None;
    let q = if has_bw {
        if matches!(filter_type, FilterType::LowShelf | FilterType::HighShelf) {
            return Err("BW Oct is unsupported for shelf filters".into());
        }
        let mut bw_tokens = rest.split_whitespace().skip_while(|token| *token != "bw");
        bw_tokens.next();
        if bw_tokens.next() != Some("oct") {
            return Err("Expected BW Oct followed by a positive bandwidth".into());
        }
        let bw = bw_tokens
            .next()
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| value.is_finite() && *value > 0.0)
            .ok_or("BW Oct must be finite and positive")?;
        // Analog octave-bandwidth relation. APO also applies omega/sin(omega)
        // at runtime, so exact digital conversion requires its sample rate.
        // Reference: mirror/equalizerapo 53d885f, filters/BiQuad.cpp.
        warning = Some("BW Oct normalized to Q using the analog bandwidth relation; APO's sample-rate-dependent response may differ");
        1.0 / (2.0 * (std::f64::consts::LN_2 * bw / 2.0).sinh())
    } else if has_q {
        extract_number_after(rest, "Q").ok_or("Invalid Q")?
    } else if matches!(filter_type, FilterType::HighPass | FilterType::LowPass) {
        std::f64::consts::FRAC_1_SQRT_2
    } else if filter_type == FilterType::Peak {
        return Err("Missing Q or BW Oct".into());
    } else {
        warning = Some("Shelf without Q imported with legacy Q 1.0; APO shelf defaults may differ");
        1.0
    };
    if !gain.is_finite() || !q.is_finite() || q <= 0.0 {
        return Err("Gain must be finite and Q must be finite and positive".into());
    }

    Ok(ParsedFilterLine {
        index,
        enabled,
        filter_type,
        freq,
        gain,
        q,
        warning,
    })
}
fn extract_number_after(s: &str, keyword: &str) -> Option<f64> {
    let lower = s.to_ascii_lowercase();
    let keyword_lower = keyword.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut search_start = 0;
    while let Some(pos) = lower[search_start..].find(&keyword_lower) {
        let actual_pos = search_start + pos;
        let prefix_ok = actual_pos == 0 || !bytes[actual_pos - 1].is_ascii_alphanumeric();
        let suffix_ok = bytes
            .get(actual_pos + keyword.len())
            .is_none_or(|b| !b.is_ascii_alphabetic());

        if !prefix_ok || !suffix_ok {
            search_start = actual_pos + 1;
            continue;
        }

        // Do not take a later field's number when this value is malformed.
        return Some(
            lower[actual_pos + keyword.len()..]
                .split_whitespace()
                .next()
                .and_then(|value| value.parse::<f64>().ok())
                .unwrap_or(f64::NAN),
        );
    }
    None
}

fn contains_token(haystack: &str, token: &str) -> bool {
    haystack
        .split(|c: char| !c.is_ascii_alphanumeric())
        .any(|w| w == token)
}

pub fn autoeq_token(filter_type: FilterType) -> &'static str {
    match filter_type {
        FilterType::Peak => "PK",
        FilterType::LowShelf => "LSC",
        FilterType::HighShelf => "HSC",
        FilterType::HighPass => "HP",
        FilterType::LowPass => "LP",
    }
}

fn format_filter_number(value: f64, decimals: usize) -> String {
    let formatted = format!("{value:.decimals$}");
    let trimmed = formatted
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string();
    if trimmed.parse::<f64>().is_ok_and(|parsed| parsed == value) {
        trimmed
    } else {
        // AutoEQ accepts exponent notation. If the human-friendly rounded
        // form would lose the value, retain the shortest round-trippable
        // representation instead of silently changing the user's EQ.
        format!("{value:?}")
    }
}

pub fn peq_to_autoeq(peq: &PEQData) -> String {
    let mut preamp_str = format_filter_number(peq.global_gain, 2);
    // "-0" reparses as a zero preamp that trips the empty-profile check;
    // write canonical zero instead.
    if preamp_str == "-0" {
        preamp_str = "0".to_string();
    }
    let mut lines = vec![format!("Preamp: {} dB", preamp_str)];

    let mut sorted_filters = peq.filters.clone();
    sorted_filters.sort_by_key(|f| f.freq);

    for (i, f) in sorted_filters.iter().enumerate() {
        let on_off = if f.enabled { "ON" } else { "OFF" };
        let type_str = autoeq_token(f.filter_type);
        lines.push(format!(
            "Filter {}: {} {} Fc {} Hz Gain {} dB Q {}",
            i + 1,
            on_off,
            type_str,
            f.freq,
            format_filter_number(f.gain, 2),
            format_filter_number(f.q, 3)
        ));
    }

    lines.join("\n")
}

mod device;
mod objective;
mod optimizer;

pub use device::AutoEqTarget;

/// A least-squares iteration is much more work than the old gradient step.
/// Bound interactive latency; convergence usually stops before this ceiling.
pub const MAX_OPTIMIZATION_STEPS: usize = 80;

const K: usize = 384;
const MAX_N: usize = MAX_FILTERS;

#[derive(Clone, Copy, Debug)]
struct InitFilter {
    pub f0: f32,
    pub gain: f32,
    pub q: f32,
}

#[derive(Clone, Copy, Debug)]
struct Lim {
    pub lo: f32,
    pub hi: f32,
}

#[derive(Clone, Copy, Debug)]
struct Smooth {
    pub smooth_f0: f32,
    pub smooth_f1: f32,
    pub smooth_lo: f32,
    pub smooth_hi: f32,
    pub bias_f0: f32,
    pub bias_f1: f32,
    pub bias_f2: f32,
    pub bias_f3: f32,
    pub bias_lo: f32,
    pub bias_md: f32,
    pub bias_hi: f32,
    pub clip_f: f32,
}

// Treble smoothing starts at 8 kHz. Below that, coupler measurements match
// listeners well and the Harman preference models reward correcting them;
// above it, insertion depth and ear-canal differences dominate. Starting at
// 3–6 kHz cost 2–6 preference points on the oratory1990 set.
const IE_SMOOTH: Smooth = Smooth {
    smooth_lo: 0.3,
    smooth_hi: 0.03,
    smooth_f0: 8000.0,
    smooth_f1: 16000.0,
    bias_lo: 0.0,
    bias_md: 0.15,
    bias_hi: 0.03,
    bias_f0: 10000.0,
    bias_f1: 13000.0,
    bias_f2: 14000.0,
    bias_f3: 20000.0,
    clip_f: 18500.0,
};

const OE_SMOOTH: Smooth = Smooth {
    smooth_lo: 0.3,
    smooth_hi: 0.03,
    smooth_f0: 8000.0,
    smooth_f1: 16000.0,
    bias_lo: 0.0,
    bias_md: 0.3,
    bias_hi: 0.2,
    bias_f0: 9000.0,
    bias_f1: 12000.0,
    bias_f2: 12000.0,
    bias_f3: 20000.0,
    clip_f: 17000.0,
};

fn spectrum_values(
    filter_type: FilterType,
    f0: f32,
    gain: f32,
    q: f32,
    fs: f32,
    f: &[f32],
    y: &mut [f32],
) {
    crate::eq::iir_math::accumulate_response_values(
        filter_type,
        f0 as f64,
        gain as f64,
        q as f64,
        fs as f64,
        f,
        y,
    );
}

#[derive(Clone, Copy)]
struct Peak {
    width: f32,
    height: f32,
    idx: i32,
}

fn largest_peak(x: &[f32; K], f: &[f32; K], lim: Lim) -> Peak {
    let mut peaks = [0; K / 2];
    let mut n = 0;
    let i_max = K - 1;

    let mut i = 1;
    while i < i_max {
        if f[i] < lim.lo || f[i] > lim.hi {
            i += 1;
            continue;
        }

        if x[i - 1] >= x[i] {
            i += 1;
            continue;
        }

        let mut i_ahead = i + 1;
        while i_ahead < i_max && x[i_ahead] == x[i] {
            i_ahead += 1;
        }

        if x[i_ahead] < x[i] {
            let left_edge = i;
            let right_edge = i_ahead - 1;
            peaks[n] = (left_edge + right_edge) / 2;
            n += 1;
            i = i_ahead;
        } else {
            i += 1;
        }
    }

    let mut prominences = [0.0; K / 2];
    let mut left_bases = [0; K / 2];
    let mut right_bases = [0; K / 2];

    for p in 0..n {
        let peak = peaks[p];
        let x_peak = x[peak];

        left_bases[p] = peak;
        let mut left_min = x_peak;
        let mut idx = peak;
        while idx > 0 && x[idx] <= x_peak {
            if x[idx] < left_min {
                left_min = x[idx];
                left_bases[p] = idx;
            }
            idx -= 1;
        }

        right_bases[p] = peak;
        let mut right_min = x_peak;
        let mut idx = peak;
        while idx <= i_max && x[idx] <= x_peak {
            if x[idx] < right_min {
                right_min = x[idx];
                right_bases[p] = idx;
            }
            idx += 1;
        }

        prominences[p] = x_peak - left_min.max(right_min);
    }

    let mut largest = Peak {
        idx: -1,
        width: 0.0,
        height: 0.0,
    };
    let mut largest_size = 0.0;

    for p in 0..n {
        let i_min = left_bases[p];
        let i_max = right_bases[p];
        let peak = peaks[p];
        let x_peak = x[peak];
        let height = x_peak - 0.5 * prominences[p];

        let mut idx = peak;
        while idx > i_min && height < x[idx] {
            idx -= 1;
        }

        let mut left_ip = idx as f32;
        if x[idx] < height && idx + 1 < K {
            let denom = x[idx + 1] - x[idx];
            if denom.abs() > 1e-6 {
                left_ip += (height - x[idx]) / denom;
            }
        }

        idx = peak;
        while idx < i_max && height < x[idx] {
            idx += 1;
        }

        let mut right_ip = idx as f32;
        if x[idx] < height && idx > 0 {
            let denom = x[idx - 1] - x[idx];
            if denom.abs() > 1e-6 {
                right_ip -= (height - x[idx]) / denom;
            }
        }

        let width = right_ip - left_ip;
        let size = width * x_peak;

        if size > largest_size {
            largest = Peak {
                idx: peak as i32,
                width,
                height: x_peak,
            };
            largest_size = size;
        }
    }

    largest
}

fn limit(x: &mut f32, lim: Lim) -> bool {
    let orig = *x;
    *x = x.clamp(lim.lo, lim.hi);
    *x != orig
}

fn init_pk(
    y: &[f32; K],
    f: &[f32; K],
    _fs: f32,
    lim_f0: Lim,
    lim_gain: Lim,
    lim_q: Lim,
) -> InitFilter {
    let mut rect = [0.0; K];

    for k in 0..K {
        rect[k] = y[k].max(0.0);
    }
    let peak = largest_peak(&rect, f, lim_f0);

    for k in 0..K {
        rect[k] = (-y[k]).max(0.0);
    }
    let dip = largest_peak(&rect, f, lim_f0);

    let p = if peak.width * peak.height > dip.width * dip.height {
        peak
    } else {
        dip
    };

    if p.idx == -1 {
        return InitFilter {
            f0: 1000.0,
            gain: 0.0,
            q: 1.0,
        };
    }

    let f0 = f[p.idx as usize];
    let mut gain = if p.idx == peak.idx {
        peak.height
    } else {
        -dip.height
    };
    let bw = p.width * (f[1] / f[0]).log2();
    let bw_exp2 = 2.0_f32.powf(bw);
    let mut q = bw_exp2.sqrt() / (bw_exp2 - 1.0);

    limit(&mut gain, lim_gain);
    limit(&mut q, lim_q);

    InitFilter { f0, gain, q }
}

fn init_lsc(
    y: &[f32; K],
    f: &[f32; K],
    fs: f32,
    mut lim_f0: Lim,
    lim_gain: Lim,
    lim_q: Lim,
) -> InitFilter {
    lim_f0.lo = lim_f0.lo.max(40.0);
    lim_f0.hi = lim_f0.hi.min(10000.0);

    let mut best = 0.0;
    let mut best_idx = 0;

    let mut a = 0.0;
    for (k, value) in y.iter().enumerate() {
        a += value;
        let avg = (a / (k + 1) as f32).abs();
        if avg > best {
            best = avg;
            best_idx = k;
        }
    }

    let mut f0 = f[best_idx];
    let mut q = std::f32::consts::FRAC_1_SQRT_2;

    limit(&mut f0, lim_f0);
    limit(&mut q, lim_q);

    let mut w = [0.0; K];
    spectrum_values(FilterType::LowShelf, f0, 1.0, q, fs, f, &mut w);

    let mut p = 0.0;
    let mut c = 0.0;
    for k in 0..K {
        p += w[k] * y[k];
        c += w[k];
    }

    let mut gain = if c > 0.0 { p / c } else { 0.0 };
    limit(&mut gain, lim_gain);

    InitFilter { f0, gain, q }
}

fn init_hsc(
    y: &[f32; K],
    f: &[f32; K],
    fs: f32,
    mut lim_f0: Lim,
    lim_gain: Lim,
    lim_q: Lim,
) -> InitFilter {
    lim_f0.lo = lim_f0.lo.max(40.0);
    lim_f0.hi = lim_f0.hi.min(10000.0);

    let mut best = 0.0;
    let mut best_idx = 0;

    let mut a = 0.0;
    for k in 0..K {
        a += y[K - 1 - k];
        let avg = (a / (k + 1) as f32).abs();
        if avg > best {
            best = avg;
            best_idx = K - 1 - k;
        }
    }

    let mut f0 = f[best_idx];
    let mut q = std::f32::consts::FRAC_1_SQRT_2;

    limit(&mut f0, lim_f0);
    limit(&mut q, lim_q);

    let mut w = [0.0; K];
    spectrum_values(FilterType::HighShelf, f0, 1.0, q, fs, f, &mut w);

    let mut p = 0.0;
    let mut c = 0.0;
    for k in 0..K {
        p += w[k] * y[k];
        c += w[k];
    }

    let mut gain = if c > 0.0 { p / c } else { 0.0 };
    limit(&mut gain, lim_gain);

    InitFilter { f0, gain, q }
}

fn search_freq(f: &[f32; K], val: f32) -> usize {
    let mut idx = 0;
    let mut best = 1e9_f32;
    for (i, &v) in f.iter().enumerate() {
        let d = (v - val).abs();
        if d < best {
            best = d;
            idx = i;
        }
    }
    idx
}

fn sgm(x: f32, x0: f32, x1: f32) -> f32 {
    let smooth_val = 4.0_f32;
    let k = smooth_val / (x1 - x0);
    let m = 0.5 * (x0 + x1);
    let y = k * (x - m);
    0.5 * (0.5 * y).tanh() + 0.5
}

fn adaptive_smooth(s: &Smooth, f: &[f32; K], r: &mut [f32; K]) {
    let smooth_l0 = s.smooth_f0.ln();
    let smooth_l1 = s.smooth_f1.ln();
    let bias_l0 = s.bias_f0.ln();
    let bias_l1 = s.bias_f1.ln();
    let bias_l2 = s.bias_f2.ln();
    let bias_l3 = s.bias_f3.ln();

    let x = *r;
    let clip_idx = search_freq(f, s.clip_f);

    const H: isize = 48;

    for k in 0..K {
        let f_k = f[k];
        let l = f_k.ln();
        let x_k = x[k];

        let sigma = s.smooth_lo + (s.smooth_hi - s.smooth_lo) * sgm(l, smooth_l0, smooth_l1);
        let bias = s.bias_lo
            + (s.bias_md - s.bias_lo) * sgm(l, bias_l0, bias_l1)
            + (s.bias_hi - s.bias_md) * sgm(l, bias_l2, bias_l3);

        let mut a = 0.0;
        let mut c = 0.0;

        for j in -H..=H {
            let mut s_idx = k as isize + j;
            if s_idx < 0 {
                s_idx = 0;
            } else if s_idx > clip_idx as isize {
                s_idx = clip_idx as isize;
            }

            let x_s = x[s_idx as usize];
            let d_spatial = ((j as f32) * sigma).powi(2);
            let d_range = bias * (x_s - x_k);

            let w = (-0.5 * d_spatial + d_range).exp();
            a += w * x_s;
            c += w;
        }

        r[k] = if c > 0.0 { a / c } else { x_k };
    }
}

fn treble_rolloff(f: &[f32; K], r: &mut [f32; K], f_treble: f32) {
    let treble_idx = search_freq(f, f_treble);
    let n_treble = K - treble_idx;
    if n_treble <= 1 {
        return;
    }
    let inv = 1.0 / (n_treble - 1) as f32;
    for i in 0..n_treble {
        let t = i as f32 * inv;
        let w = (0.5 * std::f32::consts::PI * t).cos();
        r[treble_idx + i] *= w;
    }
}

fn center_mean(x: &mut [f32; K]) -> f32 {
    let sum: f32 = x.iter().sum();
    let mean = sum / K as f32;
    for val in x.iter_mut() {
        *val -= mean;
    }
    mean
}

/// Largest boost the correction may ask for above its vocal-band level. The
/// preamp must offset the loudest boost, so filling a deep dip quiets
/// everything else. Upstream AutoEq caps its own curve at +6 dB:
/// https://github.com/jaakkopasanen/AutoEq/blob/7ae0f56d53074872b028649617a22bbb4232feb7/autoeq/constants.py#L10
/// On real headphone measurements, +5 dB here is at least as loud as upstream
/// AutoEq on the same inputs while scoring higher on predicted preference.
const MAX_BOOST_DB: f32 = 5.0;
const BOOST_REFERENCE_HZ: (f32, f32) = (250.0, 4000.0);

fn cap_boost(f: &[f32; K], r: &mut [f32; K]) {
    let (sum, count) = f
        .iter()
        .zip(r.iter())
        .filter(|(f, _)| (BOOST_REFERENCE_HZ.0..=BOOST_REFERENCE_HZ.1).contains(*f))
        .fold((0.0, 0), |(sum, count), (_, v)| (sum + v, count + 1));
    let ceiling = sum / count as f32 + MAX_BOOST_DB;
    for v in r.iter_mut() {
        *v = v.min(ceiling);
    }
}

fn preprocess(
    f: &[f32; K],
    dst: &[f32; K],
    src: &[f32; K],
    r: &mut [f32; K],
    smooth: Option<&Smooth>,
    demean: bool,
) -> Result<(), String> {
    let f_treble_smooth = 16000.0;
    let f_treble_unsmooth = 18500.0;

    let mut b = *src;
    if let Some(s) = smooth {
        adaptive_smooth(s, f, &mut b);
    }
    if b.iter().any(|value| !value.is_finite()) {
        return Err("AutoEQ smoothing produced non-finite values".into());
    }

    for k in 0..K {
        r[k] = dst[k] - b[k];
    }
    if r.iter().any(|value| !value.is_finite()) {
        return Err("AutoEQ residual preprocessing produced non-finite values".into());
    }
    cap_boost(f, r);

    if demean {
        let mean = center_mean(r);
        if !mean.is_finite() || r.iter().any(|value| !value.is_finite()) {
            return Err("AutoEQ residual centering produced non-finite values".into());
        }
    }

    treble_rolloff(
        f,
        r,
        if smooth.is_some() {
            f_treble_smooth
        } else {
            f_treble_unsmooth
        },
    );
    if r.iter().any(|value| !value.is_finite()) {
        return Err("AutoEQ residual preprocessing produced non-finite values".into());
    }
    Ok(())
}

fn initialize_bands(
    bands: &mut [optimizer::Band],
    f: &[f32; K],
    residual: &[f32; K],
    fs: f32,
    target: AutoEqTarget<'_>,
    cos: &[f64],
) -> Result<(), String> {
    let mut remainder = *residual;
    for band in bands {
        let initialize = match band.kind {
            FilterType::LowShelf => init_lsc,
            FilterType::HighShelf => init_hsc,
            _ => init_pk,
        };
        let p = initialize(
            &remainder,
            f,
            fs,
            band.frequency_bounds,
            band.gain_bounds,
            band.q_bounds,
        );
        band.frequency = p.f0 as f64;
        band.gain = p.gain as f64;
        band.q = p.q as f64;
        crate::eq::iir_math::accumulate_response_values_cos_for_model(
            band.kind,
            band.frequency,
            -band.gain,
            band.q,
            fs as f64,
            target.model(),
            cos,
            &mut remainder,
        )?;
    }
    Ok(())
}

/// Give a redundant or misplaced peak one deterministic relocation. Frequency
/// and Q derivatives vanish at zero gain, so more local steps cannot reliably
/// recover a band left in the wrong part of the spectrum.
fn reseed_peak(
    bands: &mut [optimizer::Band],
    f: &[f32; K],
    r: &[f32; K],
    fs: f32,
    target: AutoEqTarget<'_>,
    cos: &[f64],
) -> Result<bool, String> {
    let mut residual = *r;
    for band in bands.iter() {
        crate::eq::iir_math::accumulate_response_values_cos_for_model(
            band.kind,
            band.frequency,
            -band.gain,
            band.q,
            fs as f64,
            target.model(),
            cos,
            &mut residual,
        )?;
    }
    let mut replacement = None;
    let mut least_removal_loss = f32::INFINITY;
    let mut remainder = [0.0; K];
    for (i, band) in bands.iter().enumerate() {
        if band.kind != FilterType::Peak {
            continue;
        }
        let mut removed = residual;
        crate::eq::iir_math::accumulate_response_values_cos_for_model(
            band.kind,
            band.frequency,
            band.gain,
            band.q,
            fs as f64,
            target.model(),
            cos,
            &mut removed,
        )?;
        center_mean(&mut removed);
        let loss = removed.iter().map(|v| v * v).sum::<f32>() / K as f32;
        if loss < least_removal_loss {
            least_removal_loss = loss;
            replacement = Some(i);
            remainder = removed;
        }
    }
    let Some(i) = replacement else {
        return Ok(false);
    };
    let band = &mut bands[i];
    let p = init_pk(
        &remainder,
        f,
        fs,
        band.frequency_bounds,
        band.gain_bounds,
        band.q_bounds,
    );
    band.frequency = p.f0 as f64;
    band.gain = p.gain as f64;
    band.q = p.q as f64;
    Ok(true)
}

fn generate_log_spaced_freqs() -> [f32; K] {
    let f0 = 20.0_f32;
    let f1 = 20000.0_f32;
    let l0 = f0.ln();
    let l1 = f1.ln();
    let lr = l1 - l0;

    let mut freqs = [0.0; K];
    for (k, freq) in freqs.iter_mut().enumerate() {
        *freq = (l0 + lr / (K - 1) as f32 * k as f32).exp();
    }
    freqs
}

fn interpolate_curve(
    label: &str,
    points: &[(f64, f64)],
    freqs: &[f32; K],
) -> Result<[f32; K], String> {
    let mut curve = [0.0; K];
    if points.is_empty() {
        return Ok(curve);
    }

    let mut sorted = points.to_vec();
    sorted.sort_by(|a, b| a.0.total_cmp(&b.0));

    let n = sorted.len();
    let lx: Vec<f64> = sorted.iter().map(|p| p.0.ln()).collect();

    let mut i = 0;
    for j in 0..K {
        let t = (freqs[j] as f64).ln();
        let value = if t <= lx[0] {
            sorted[0].1
        } else if t >= lx[n - 1] {
            sorted[n - 1].1
        } else {
            while i + 1 < n - 1 && lx[i + 1] < t {
                i += 1;
            }

            let x0 = lx[i];
            let x1 = lx[i + 1];
            let den = x1 - x0;
            let u = if den == 0.0 { 0.0 } else { (t - x0) / den };
            sorted[i].1 + u * (sorted[i + 1].1 - sorted[i].1)
        };
        let value = value as f32;
        if !value.is_finite() {
            return Err(format!("{label} interpolation produced non-finite values"));
        }
        curve[j] = value;
    }
    Ok(curve)
}

const AUTOEQ_FILTER_TYPES: &[FilterType] = &[
    FilterType::Peak,
    FilterType::LowShelf,
    FilterType::HighShelf,
];

pub fn run_autoeq(
    measurement_points: &[(f64, f64)],
    target_points: &[(f64, f64)],
    n_bands: usize,
    steps: usize,
    smooth_type: &str,
    fs: f32,
    caps: Option<&crate::device::DeviceCapabilities>,
) -> Result<crate::eq::PEQData, String> {
    run_autoeq_with_target(
        measurement_points,
        target_points,
        n_bands,
        steps,
        smooth_type,
        fs,
        AutoEqTarget::capabilities(caps),
    )
}

/// Fit, realize, and score against one immutable DAC target. Unlike the
/// capabilities-only API, this includes protocol precision and DSP semantics.
pub fn run_autoeq_with_target(
    measurement_points: &[(f64, f64)],
    target_points: &[(f64, f64)],
    n_bands: usize,
    steps: usize,
    smooth_type: &str,
    fs: f32,
    target: AutoEqTarget<'_>,
) -> Result<crate::eq::PEQData, String> {
    let caps = target.caps;
    if n_bands == 0 || n_bands > MAX_N {
        return Err("Number of bands must be between 1 and 32".to_string());
    }
    validate_curve("Measurement", measurement_points)?;
    validate_curve("Target", target_points)?;
    if !fs.is_finite() || !(40_000.0..=768_000.0).contains(&fs) {
        return Err("Sample rate must be between 40000 and 768000 Hz".into());
    }
    if let Some(caps) = caps {
        crate::device::normalization::validate_capabilities(caps)?;
        if n_bands > caps.num_bands {
            return Err(format!(
                "Requested {n_bands} AutoEQ bands, but the device supports only {}",
                caps.num_bands
            ));
        }
        if (fs as f64 - caps.dsp_sample_rate).abs() > 0.5 {
            return Err(format!(
                "Sample rate {fs} does not match the device DSP sample rate {}",
                caps.dsp_sample_rate
            ));
        }
        if caps.band_gain_range.1.abs() > f32::MAX as f64 || caps.q_range.1.abs() > f32::MAX as f64
        {
            return Err("AutoEQ capability ranges exceed the optimizer numeric domain".into());
        }
        if caps.q_range.0 < 0.01 {
            return Err("AutoEQ capability Q range is below the canonical 0.01 minimum".into());
        }
        if caps.q_range.1 > 100.0 {
            return Err("AutoEQ capability Q range exceeds the canonical 100 maximum".into());
        }
        if caps.band_gain_range.0 < -150.0 || caps.band_gain_range.1 > 150.0 {
            return Err(
                "AutoEQ capability gain range exceeds the canonical +/-150 dB domain".into(),
            );
        }
    }
    if !matches!(
        smooth_type.to_ascii_lowercase().as_str(),
        "none" | "ie" | "oe"
    ) {
        return Err("Smoothing must be none, ie, or oe".into());
    }

    let steps = if steps == 0 {
        MAX_OPTIMIZATION_STEPS
    } else {
        steps.min(MAX_OPTIMIZATION_STEPS)
    };

    let f = generate_log_spaced_freqs();
    let src = interpolate_curve("Measurement", measurement_points, &f)?;
    let dst = interpolate_curve("Target", target_points, &f)?;

    let smooth = match smooth_type.to_lowercase().as_str() {
        "ie" => Some(&IE_SMOOTH),
        "oe" => Some(&OE_SMOOTH),
        _ => None,
    };

    let mut r = [0.0; K];
    preprocess(&f, &dst, &src, &mut r, smooth, true)?;
    let safety = device::SafetyGrid::new(fs as f64);
    let objective = objective::Objective::new(&f);
    let cos: Vec<_> = f
        .iter()
        .map(|&frequency| (std::f64::consts::TAU * frequency as f64 / fs as f64).cos())
        .collect();

    // Work inside the device's feasible set: every filter type selected by the
    // optimizer must be advertised by the DAC. The optimizer has analytic
    // gradients for peak and shelf filters; pass filters remain available for
    // manual editing but are not substituted into a model that cannot fit them.
    let supported_types = caps.map_or(FilterType::ALL, |c| c.supported_filter_types);
    let supports = |filter_type: FilterType| supported_types.contains(&filter_type);
    let default_type = AUTOEQ_FILTER_TYPES
        .iter()
        .copied()
        .find(|filter_type| supports(*filter_type))
        .ok_or_else(|| {
            "AutoEQ requires a DAC with Peak, LowShelf, or HighShelf support".to_string()
        })?;
    let mut types = vec![default_type; n_bands];
    if n_bands >= 1 && supports(FilterType::LowShelf) {
        types[0] = FilterType::LowShelf;
    }
    if n_bands >= 2 && supports(FilterType::HighShelf) {
        types[1] = FilterType::HighShelf;
    }

    // Intersect the generic optimizer bounds with the device ranges. When a
    // device range does not overlap the default, the device range wins: the
    // result must always be something the DAC can reproduce.
    fn intersect(lo: f32, hi: f32, clo: f64, chi: f64) -> Lim {
        let lo = lo.max(clo as f32);
        let hi = hi.min(chi as f32);
        if lo <= hi {
            Lim { lo, hi }
        } else {
            Lim {
                lo: clo as f32,
                hi: chi as f32,
            }
        }
    }
    let (cap_gain_lo, cap_gain_hi) = caps.map_or((-16.0, 16.0), |c| c.band_gain_range);
    let (cap_q_lo, cap_q_hi) = caps.map_or((0.4, 4.0), |c| (c.q_range.0.max(0.01), c.q_range.1));
    if cap_q_lo > cap_q_hi {
        return Err("AutoEQ Q capability range is empty".into());
    }
    let (cap_f_lo, cap_f_hi) = caps.map_or((20.0, 20000.0), |c| {
        (
            (c.freq_range.0 as f64).max(20.0),
            (c.freq_range.1 as f64).min((0.49 * fs as f64).floor()),
        )
    });
    if cap_f_lo > cap_f_hi {
        return Err("AutoEQ frequency capabilities exceed the sample-rate domain".into());
    }

    // Upstream AutoEq explicitly supports five filters: one low shelf + four
    // peaks, with its 5+5 legacy export fitting a second stage to the residual.
    // Compare layouts at every band count instead of reserving two bands for
    // shelves even when the correction is better represented by interior peaks.
    // Reference (protocol/data independent; no copied optimizer code):
    // https://github.com/jaakkopasanen/AutoEq/blob/7ae0f56d53074872b028649617a22bbb4232feb7/autoeq/constants.py#L115-L134
    // Upstream defaults shelf Q to 0.4..0.7 to avoid resonant shelves:
    // https://github.com/jaakkopasanen/AutoEq/blob/7ae0f56d53074872b028649617a22bbb4232feb7/autoeq/constants.py#L54-L55
    let low_band = n_bands <= 5;
    let finish = |bands: &[optimizer::Band]| -> Result<(PEQData, f32), String> {
        let mut filters: Vec<_> = bands
            .iter()
            .enumerate()
            .map(|(i, band)| Filter {
                index: i as u8,
                enabled: true,
                freq: band.frequency.round() as u16,
                gain: band.gain,
                q: band.q,
                filter_type: band.kind,
            })
            .collect();
        filters.sort_by_key(|f| f.freq);
        for (i, filter) in filters.iter_mut().enumerate() {
            filter.index = i as u8;
        }
        let peq = target.finalize(filters, fs as f64, &safety)?;
        let loss = device::shape_loss(&peq.filters, fs as f64, target, &cos, &r, &objective)?;
        Ok((peq, loss))
    };
    let fit_layout =
        |types: Vec<FilterType>| -> Result<(PEQData, f32, Vec<optimizer::Band>), String> {
            let mut f0_lim = vec![intersect(20.0, 16000.0, cap_f_lo, cap_f_hi); n_bands];
            let gain_lim = vec![intersect(-16.0, 16.0, cap_gain_lo, cap_gain_hi); n_bands];
            let mut q_lim = vec![intersect(0.4, 4.0, cap_q_lo, cap_q_hi); n_bands];
            for n in 0..n_bands {
                match types[n] {
                    FilterType::LowShelf => {
                        f0_lim[n] = intersect(20.0, 500.0, cap_f_lo, cap_f_hi);
                        q_lim[n] =
                            intersect(0.4, if low_band { 0.7 } else { 3.0 }, cap_q_lo, cap_q_hi);
                    }
                    FilterType::HighShelf => {
                        f0_lim[n] = intersect(3000.0, 20000.0, cap_f_lo, cap_f_hi);
                        q_lim[n] =
                            intersect(0.4, if low_band { 0.7 } else { 3.0 }, cap_q_lo, cap_q_hi);
                    }
                    _ => {}
                }
            }
            if target.model() == crate::eq::iir_math::EqResponseModel::MoondropShelfSlope {
                for (kind, lim) in types.iter().zip(&mut q_lim) {
                    if *kind != FilterType::Peak {
                        lim.hi = lim.hi.min(1.0);
                        if lim.lo > lim.hi {
                            return Err("Device has no feasible non-resonant shelf slope".into());
                        }
                    }
                }
            }
            let mut bands: Vec<_> = (0..n_bands)
                .map(|i| optimizer::Band {
                    kind: types[i],
                    frequency: 1000.0,
                    gain: 0.0,
                    q: 1.0,
                    frequency_bounds: f0_lim[i],
                    gain_bounds: gain_lim[i],
                    q_bounds: q_lim[i],
                })
                .collect();
            initialize_bands(&mut bands, &f, &r, fs, target, &cos)?;
            let fit_loss = optimizer::fit(
                &mut bands,
                steps,
                &f,
                &r,
                fs as f64,
                target.model(),
                &objective,
            );
            if !(fit_loss as f32).is_finite() {
                return Err("AutoEQ optimization produced a non-finite loss".into());
            }
            let (peq, loss) = finish(&bands)?;
            Ok((peq, loss, bands))
        };
    let mut layouts = vec![types];
    if supports(FilterType::Peak) {
        for shelf in [
            Some(FilterType::LowShelf),
            Some(FilterType::HighShelf),
            None,
        ] {
            if shelf.is_some_and(|kind| !supports(kind)) {
                continue;
            }
            let mut candidate = vec![FilterType::Peak; n_bands];
            if let Some(kind) = shelf {
                candidate[0] = kind;
            }
            if !layouts.contains(&candidate) {
                layouts.push(candidate);
            }
        }
    }
    // Keep the earliest layout on ties, and its error if every layout fails.
    let mut fitted = map_layouts(layouts, fit_layout).into_iter();
    let mut best = fitted.next().expect("the default layout is always fitted");
    for candidate in fitted {
        if let Ok((_, loss, _)) = &candidate {
            if best
                .as_ref()
                .map_or(true, |(_, best_loss, _)| loss < best_loss)
            {
                best = candidate;
            }
        }
    }
    let (mut peq, mut loss, mut bands) = best?;
    // Preserve the broad fit as an incumbent, then let peaks use the DAC's
    // full Q range during refinement. The legacy Q=4 ceiling cannot reproduce
    // narrow resonances even when the hardware can.
    let mut wider_q = false;
    for band in &mut bands {
        if band.kind == FilterType::Peak && cap_q_hi as f32 > band.q_bounds.hi {
            wider_q |= band.q >= band.q_bounds.hi as f64 * (1.0 - 1e-6);
            band.q_bounds.hi = cap_q_hi as f32;
        }
    }
    if wider_q {
        optimizer::fit(
            &mut bands,
            steps,
            &f,
            &r,
            fs as f64,
            target.model(),
            &objective,
        );
        if let Ok((candidate, candidate_loss)) = finish(&bands) {
            if candidate_loss < loss {
                peq = candidate;
                loss = candidate_loss;
            }
        }
    }
    if reseed_peak(&mut bands, &f, &r, fs, target, &cos)? {
        optimizer::fit(
            &mut bands,
            steps,
            &f,
            &r,
            fs as f64,
            target.model(),
            &objective,
        );
        if let Ok((candidate, candidate_loss)) = finish(&bands) {
            if candidate_loss < loss {
                return Ok(candidate);
            }
        }
    }
    Ok(peq)
}

/// Fit independent layouts on their own threads where the target has them.
fn map_layouts<T: Send>(
    layouts: Vec<Vec<FilterType>>,
    fit: impl Fn(Vec<FilterType>) -> T + Sync,
) -> Vec<T> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let fit = &fit;
        std::thread::scope(|scope| {
            let handles: Vec<_> = layouts
                .into_iter()
                .map(|layout| scope.spawn(move || fit(layout)))
                .collect();
            handles
                .into_iter()
                .map(|handle| {
                    handle
                        .join()
                        .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
                })
                .collect()
        })
    }
    #[cfg(target_arch = "wasm32")]
    {
        layouts.into_iter().map(fit).collect()
    }
}

fn validate_curve(label: &str, points: &[(f64, f64)]) -> Result<(), String> {
    if points.len() > MAX_CURVE_POINTS {
        return Err(format!("{label} exceeds maximum point count (100000)"));
    }
    if points.len() < 2 {
        return Err(format!("{label} needs at least 2 points"));
    }
    if points.iter().any(|(frequency, db)| {
        !frequency.is_finite() || !db.is_finite() || !(20.0..=20_000.0).contains(frequency)
    }) {
        return Err(format!(
            "{label} points must be finite and between 20 and 20000 Hz"
        ));
    }
    Ok(())
}
