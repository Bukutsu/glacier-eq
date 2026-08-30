// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use crate::{Filter, FilterType, PEQData};

pub const MAX_FILTERS: usize = 32;

/// Parses frequency/dB curves using the same rules as the frontend importer.
pub fn parse_curve_text(text: &str) -> Result<Vec<(f64, f64)>, String> {
    if text.len() > 1 << 20 || text.lines().count() > 4096 {
        return Err("Curve input exceeds maximum size".into());
    }
    let points = text.lines().filter_map(|line| {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
            return None;
        }
        let mut columns = line
            .split([',', '\t', ';', ' '])
            .filter(|column| !column.is_empty());
        let frequency = columns.next()?.parse::<f64>().ok()?;
        let db = columns.next()?.parse::<f64>().ok()?;
        Some((frequency, db))
    });
    normalize_curve_points(points.collect())
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
            if let Some(parsed) = parse_filter_line(line) {
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
                let freq: u16 = if !parsed.freq.is_finite()
                    || parsed.freq < 1.0
                    || parsed.freq > 1_000_000.0
                    || parsed.freq > u16::MAX as f64
                {
                    warnings.push(format!(
                        "Line {}: Frequency {} Hz out of range [1, {}]; clamping",
                        line_num,
                        parsed.freq,
                        u16::MAX
                    ));
                    // `clamp` propagates NaN and `NaN as u16` saturates to 0,
                    // so non-finite input must be replaced before the cast.
                    if !parsed.freq.is_finite() {
                        1
                    } else {
                        parsed.freq.clamp(1.0, u16::MAX as f64) as u16
                    }
                } else {
                    parsed.freq as u16
                };
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
            } else {
                warnings.push(format!("Line {}: Failed to parse filter", line_num));
            }
        }
    }

    // An explicit "Preamp: 0 dB" line is a valid identity EQ; only reject
    // files with nothing recognizable at all.
    if parsed_count == 0 && !preamp_seen && preamp.abs() < 1e-5 {
        return Err("No valid filters or preamp found in AutoEQ text".into());
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
    let start = s.find(|c: char| c == '-' || c == '+' || c.is_ascii_digit())?;

    let mut end = start;
    let mut has_decimal = false;
    for c in s[start..].chars() {
        if c.is_ascii_digit() {
            end += c.len_utf8();
        } else if c == '.' && !has_decimal {
            has_decimal = true;
            end += c.len_utf8();
        } else if (c == '-' || c == '+') && end == start {
            end += c.len_utf8();
        } else {
            break;
        }
    }

    s[start..end].parse().ok()
}

struct ParsedFilterLine {
    index: Option<usize>,
    enabled: bool,
    filter_type: FilterType,
    freq: f64,
    gain: f64,
    q: f64,
}

fn parse_filter_line(line: &str) -> Option<ParsedFilterLine> {
    let lower = line.to_ascii_lowercase();
    let filter_idx = lower.find("filter")?;
    let rest = &lower[filter_idx + 6..];

    let digits: String = rest
        .chars()
        .skip_while(|c| c.is_whitespace())
        .take_while(|c| c.is_ascii_digit())
        .collect();

    let idx: Option<usize> = if digits.is_empty() {
        None
    } else {
        let i: usize = digits.parse().ok()?;
        Some(i.saturating_sub(1))
    };

    let on_off = !lower.contains("off");
    let rest_upper = rest.to_uppercase();

    let filter_type = if contains_token(&rest_upper, "LSC")
        || contains_token(&rest_upper, "LSQ")
        || contains_token(&rest_upper, "LOWSHELF")
    {
        FilterType::LowShelf
    } else if contains_token(&rest_upper, "HSC")
        || contains_token(&rest_upper, "HSQ")
        || contains_token(&rest_upper, "HIGHSHELF")
    {
        FilterType::HighShelf
    } else if contains_token(&rest_upper, "HP")
        || contains_token(&rest_upper, "HPF")
        || contains_token(&rest_upper, "HIGHPASS")
    {
        FilterType::HighPass
    } else if contains_token(&rest_upper, "LP")
        || contains_token(&rest_upper, "LPF")
        || contains_token(&rest_upper, "LOWPASS")
    {
        FilterType::LowPass
    } else if contains_token(&rest_upper, "LS") {
        FilterType::LowShelf
    } else if contains_token(&rest_upper, "HS") {
        FilterType::HighShelf
    } else {
        FilterType::Peak
    };

    let freq = extract_number_after(rest, "Fc")?;
    let gain = extract_number_after(rest, "Gain").unwrap_or(0.0);
    let q = extract_number_after(rest, "Q").unwrap_or(1.0);
    if !gain.is_finite() || !q.is_finite() || q <= 0.0 {
        return None;
    }

    Some(ParsedFilterLine {
        index: idx,
        enabled: on_off,
        filter_type,
        freq,
        gain,
        q,
    })
}

fn extract_number_after(s: &str, keyword: &str) -> Option<f64> {
    let lower = s.to_ascii_lowercase();
    let keyword_lower = keyword.to_ascii_lowercase();
    let mut search_start = 0;
    while let Some(pos) = lower[search_start..].find(&keyword_lower) {
        let actual_pos = search_start + pos;
        if keyword_lower == "q" {
            // Ensure the matched 'q' is not part of a token like "lsq", "hsq"
            let slice_before = &lower[..actual_pos];
            let is_filter_type_q = slice_before.ends_with("ls") || slice_before.ends_with("hs");
            if is_filter_type_q {
                search_start = actual_pos + 1;
                continue;
            }
        }
        return extract_number(&lower[actual_pos + keyword.len()..]);
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

pub fn peq_to_autoeq(peq: &PEQData) -> String {
    let mut preamp_str = format!("{:.2}", peq.global_gain)
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string();
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
            "Filter {}: {} {} Fc {} Hz Gain {:.2} dB Q {:.3}",
            i + 1,
            on_off,
            type_str,
            f.freq,
            f.gain,
            f.q
        ));
    }

    lines.join("\n")
}

const K: usize = 384;
const MAX_N: usize = MAX_FILTERS;

#[derive(Clone, Copy, Debug)]
struct Biquad {
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub a0: f32,
    pub a1: f32,
    pub a2: f32,

    pub db0_da: f32,
    pub db0_dalpha: f32,
    pub db0_dcos: f32,
    pub db1_da: f32,
    pub db1_dcos: f32,
    pub db2_da: f32,
    pub db2_dalpha: f32,
    pub db2_dcos: f32,
    pub da0_da: f32,
    pub da0_dalpha: f32,
    pub da0_dcos: f32,
    pub da1_da: f32,
    pub da1_dcos: f32,
    pub da2_da: f32,
    pub da2_dalpha: f32,
    pub da2_dcos: f32,
}

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

const IE_SMOOTH: Smooth = Smooth {
    smooth_lo: 0.3,
    smooth_hi: 0.03,
    smooth_f0: 3000.0,
    smooth_f1: 12000.0,
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
    smooth_f0: 5000.0,
    smooth_f1: 15000.0,
    bias_lo: 0.0,
    bias_md: 0.3,
    bias_hi: 0.2,
    bias_f0: 6000.0,
    bias_f1: 9000.0,
    bias_f2: 9000.0,
    bias_f3: 20000.0,
    clip_f: 17000.0,
};

fn pk(a_val: f32, cos_w: f32, alpha: f32) -> Biquad {
    let r_a = 1.0 / a_val;
    Biquad {
        b0: a_val * alpha + 1.0,
        db0_da: alpha,
        db0_dalpha: a_val,
        db0_dcos: 0.0,

        b1: -2.0 * cos_w,
        db1_da: 0.0,
        db1_dcos: -2.0,

        b2: -a_val * alpha + 1.0,
        db2_da: -alpha,
        db2_dalpha: -a_val,
        db2_dcos: 0.0,

        a0: (a_val + alpha) * r_a,
        da0_da: -alpha * r_a * r_a,
        da0_dalpha: r_a,
        da0_dcos: 0.0,

        a1: -2.0 * cos_w,
        da1_da: 0.0,
        da1_dcos: -2.0,

        a2: (a_val - alpha) * r_a,
        da2_da: alpha * r_a * r_a,
        da2_dalpha: -r_a,
        da2_dcos: 0.0,
    }
}

fn lsc(a_val: f32, cos_w: f32, alpha: f32) -> Biquad {
    let p1 = a_val + 1.0;
    let m1 = a_val - 1.0;
    let sqrt_a = a_val.sqrt();
    let k_val = 2.0 * sqrt_a * alpha;
    let dk_da = alpha / sqrt_a;
    let dk_dalpha = 2.0 * sqrt_a;

    Biquad {
        b0: a_val * (-cos_w * m1 + k_val + p1),
        db0_da: a_val * dk_da - a_val * cos_w + a_val - cos_w * m1 + k_val + p1,
        db0_dalpha: a_val * dk_dalpha,
        db0_dcos: -a_val * m1,

        b1: 2.0 * a_val * (-cos_w * p1 + m1),
        db1_da: -2.0 * a_val * cos_w + 2.0 * a_val - 2.0 * cos_w * p1 + 2.0 * m1,
        db1_dcos: -2.0 * a_val * p1,

        b2: a_val * (-cos_w * m1 - k_val + p1),
        db2_da: -a_val * dk_da - a_val * cos_w + a_val - cos_w * m1 - k_val + p1,
        db2_dalpha: -a_val * dk_dalpha,
        db2_dcos: -a_val * m1,

        a0: cos_w * m1 + k_val + p1,
        da0_da: dk_da + cos_w + 1.0,
        da0_dalpha: dk_dalpha,
        da0_dcos: m1,

        a1: -2.0 * cos_w * p1 - 2.0 * m1,
        da1_da: -2.0 * cos_w - 2.0,
        da1_dcos: -2.0 * p1,

        a2: cos_w * m1 - k_val + p1,
        da2_da: -dk_da + cos_w + 1.0,
        da2_dalpha: -dk_dalpha,
        da2_dcos: m1,
    }
}

fn hsc(a_val: f32, cos_w: f32, alpha: f32) -> Biquad {
    let p1 = a_val + 1.0;
    let m1 = a_val - 1.0;
    let sqrt_a = a_val.sqrt();
    let k_val = 2.0 * sqrt_a * alpha;
    let dk_da = alpha / sqrt_a;
    let dk_dalpha = 2.0 * sqrt_a;

    Biquad {
        b0: a_val * (cos_w * m1 + k_val + p1),
        db0_da: a_val * dk_da + a_val * cos_w + a_val + cos_w * m1 + k_val + p1,
        db0_dalpha: a_val * dk_dalpha,
        db0_dcos: a_val * m1,

        b1: -2.0 * a_val * (cos_w * p1 + m1),
        db1_da: -2.0 * a_val * cos_w - 2.0 * a_val - 2.0 * cos_w * p1 - 2.0 * m1,
        db1_dcos: -2.0 * a_val * p1,

        b2: a_val * (cos_w * m1 - k_val + p1),
        db2_da: -a_val * dk_da + a_val * cos_w + a_val + cos_w * m1 - k_val + p1,
        db2_dalpha: -a_val * dk_dalpha,
        db2_dcos: a_val * m1,

        a0: -cos_w * m1 + k_val + p1,
        da0_da: dk_da - cos_w + 1.0,
        da0_dalpha: dk_dalpha,
        da0_dcos: -m1,

        a1: -2.0 * cos_w * p1 + 2.0 * m1,
        da1_da: 2.0 - 2.0 * cos_w,
        da1_dcos: -2.0 * p1,

        a2: -cos_w * m1 - k_val + p1,
        da2_da: -dk_da - cos_w + 1.0,
        da2_dalpha: -dk_dalpha,
        da2_dcos: -m1,
    }
}

fn biquad_fn(filter_type: FilterType, a_val: f32, cos_w: f32, alpha: f32) -> Biquad {
    match filter_type {
        FilterType::Peak => pk(a_val, cos_w, alpha),
        FilterType::LowShelf => lsc(a_val, cos_w, alpha),
        FilterType::HighShelf => hsc(a_val, cos_w, alpha),
        _ => pk(a_val, cos_w, alpha),
    }
}

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

struct Consts<'a> {
    types: &'a [FilterType],
    phi: &'a [f32; K],
    r: &'a [f32; K],
    fs: f32,
    n_bands: usize,
    opt_amp: bool,
}

fn w_from_n(n: usize) -> usize {
    3 * n + 1
}

fn q_to_bw(q: f32) -> f32 {
    let ln2 = std::f32::consts::LN_2;
    2.0 / ln2 * ((0.5 / q).asinh())
}

fn bw_to_q(bw: f32) -> f32 {
    let ln2 = std::f32::consts::LN_2;
    0.5 / ((0.5 * ln2 * bw).sinh())
}

fn grad(c: &Consts, x: &[f32], g: &mut [f32]) -> f32 {
    let n_bands = c.n_bands;
    let r_k = 1.0 / K as f32;

    let mut dy_dw0 = [[0.0; K]; MAX_N];
    let mut dy_dgain = [[0.0; K]; MAX_N];
    let mut dy_dbw = [[0.0; K]; MAX_N];

    let mut w0_v = [0.0; MAX_N];
    let mut pred = [0.0; K];

    let (x_lf, x_rest) = x.split_at(n_bands);
    let (x_gain, x_rest) = x_rest.split_at(n_bands);
    let (x_bw, x_amp) = x_rest.split_at(n_bands);

    let pred_init = if c.opt_amp {
        10.0_f32.powf(x_amp[0] / 10.0)
    } else {
        1.0
    };

    pred.fill(pred_init);

    for n in 0..n_bands {
        let f0 = x_lf[n].exp().min(0.49 * c.fs);
        let gain = x_gain[n];
        let bw = x_bw[n];

        let a_val = 10.0_f32.powf(gain / 40.0);
        let w0 = 2.0 * std::f32::consts::PI / c.fs * f0;
        let cos_w = w0.cos();
        let sin_w = w0.sin();
        let kq = (0.5 * std::f32::consts::LN_2 * bw).sinh();
        let alpha = sin_w * kq;

        w0_v[n] = w0;

        let s = biquad_fn(c.types[n], a_val, cos_w, alpha);

        let da_dgain = a_val * std::f32::consts::LN_10 / 40.0;
        let dalpha_dw0 = cos_w * kq;
        let dalpha_dbw =
            sin_w * (0.5 * std::f32::consts::LN_2 * bw).cosh() * 0.5 * std::f32::consts::LN_2;
        let dcos_dw0 = -sin_w;

        let b_x0 = (s.b0 + s.b1 + s.b2).powi(2);
        let b_x1 = -4.0 * (s.b0 * s.b1 + 4.0 * s.b0 * s.b2 + s.b1 * s.b2);
        let b_x2 = 16.0 * s.b0 * s.b2;
        let a_x0 = (s.a0 + s.a1 + s.a2).powi(2);
        let a_x1 = -4.0 * (s.a0 * s.a1 + 4.0 * s.a0 * s.a2 + s.a1 * s.a2);
        let a_x2 = 16.0 * s.a0 * s.a2;

        let ba = s.b0 + s.b1 + s.b2;
        let aa = s.a0 + s.a1 + s.a2;

        for k in 0..K {
            let phi_k = c.phi[k];

            let b_poly = b_x0 + phi_k * (b_x1 + phi_k * b_x2);
            let a_poly = a_x0 + phi_k * (a_x1 + phi_k * a_x2);

            let ratio = if a_poly > 1e-30 { b_poly / a_poly } else { 1.0 };
            pred[k] = (pred[k] * ratio).clamp(1e-30, 1e30);

            let _8phi2 = 8.0 * phi_k * phi_k;
            let _2phi = 2.0 * phi_k;

            let bm = 20.0 / std::f32::consts::LN_10 / b_poly;
            let am = -20.0 / std::f32::consts::LN_10 / a_poly;

            let dy_db0 = bm * (ba - _2phi * (s.b1 + 4.0 * s.b2) + _8phi2 * s.b2);
            let dy_db1 = bm * (ba - _2phi * (s.b0 + s.b2));
            let dy_db2 = bm * (ba - _2phi * (4.0 * s.b0 + s.b1) + _8phi2 * s.b0);

            let dy_da0 = am * (aa - _2phi * (s.a1 + 4.0 * s.a2) + _8phi2 * s.a2);
            let dy_da1 = am * (aa - _2phi * (s.a0 + s.a2));
            let dy_da2 = am * (aa - _2phi * (4.0 * s.a0 + s.a1) + _8phi2 * s.a0);

            let dy_da_local = dy_db0 * s.db0_da
                + dy_db1 * s.db1_da
                + dy_db2 * s.db2_da
                + dy_da0 * s.da0_da
                + dy_da1 * s.da1_da
                + dy_da2 * s.da2_da;

            let dy_dalpha_local = dy_db0 * s.db0_dalpha
                + dy_db2 * s.db2_dalpha
                + dy_da0 * s.da0_dalpha
                + dy_da2 * s.da2_dalpha;

            let dy_dcos_local = dy_db0 * s.db0_dcos
                + dy_db1 * s.db1_dcos
                + dy_db2 * s.db2_dcos
                + dy_da0 * s.da0_dcos
                + dy_da1 * s.da1_dcos
                + dy_da2 * s.da2_dcos;

            dy_dw0[n][k] = dy_dalpha_local * dalpha_dw0 + dy_dcos_local * dcos_dw0;
            dy_dgain[n][k] = dy_da_local * da_dgain;
            dy_dbw[n][k] = dy_dalpha_local * dalpha_dbw;
        }
    }

    let mut loss = 0.0;
    let mut dl_dy = [0.0; K];
    let mut dl_dy_sum = 0.0;

    for k in 0..K {
        let d = 10.0 * pred[k].log10() - c.r[k];
        loss += d.powi(2);
        dl_dy[k] = 2.0 * d;
        dl_dy_sum += dl_dy[k];
    }

    loss *= r_k;

    let (g_lf, g_rest) = g.split_at_mut(n_bands);
    let (g_gain, g_rest) = g_rest.split_at_mut(n_bands);
    let (g_bw, g_amp) = g_rest.split_at_mut(n_bands);

    g_amp[0] = if c.opt_amp { dl_dy_sum * r_k } else { 0.0 };

    for n in 0..n_bands {
        let mut glf = 0.0;
        let mut ggain = 0.0;
        let mut gbw = 0.0;

        for k in 0..K {
            glf += dl_dy[k] * dy_dw0[n][k];
            ggain += dl_dy[k] * dy_dgain[n][k];
            gbw += dl_dy[k] * dy_dbw[n][k];
        }

        g_lf[n] = glf * r_k * w0_v[n];
        g_gain[n] = ggain * r_k;
        g_bw[n] = gbw * r_k;
    }

    loss
}

struct AdaBelief {
    m: Vec<f32>,
    s: Vec<f32>,
    b1: f32,
    b2: f32,
    b1t: f32,
    b2t: f32,
    eps: f32,
    eps_root: f32,
    lr: f32,
    n_bands: usize,
}

impl AdaBelief {
    fn new(n_bands: usize) -> Self {
        let size = w_from_n(n_bands);
        Self {
            m: vec![0.0; size],
            s: vec![0.0; size],
            b1: 0.9,
            b2: 0.99,
            b1t: 0.9,
            b2t: 0.99,
            eps: 1e-12,
            eps_root: 1e-8,
            lr: 3e-2,
            n_bands,
        }
    }

    fn step(&mut self, x: &mut [f32], g: &[f32]) {
        let size = w_from_n(self.n_bands);
        for w in 0..size {
            self.m[w] = self.b1 * self.m[w] + (1.0 - self.b1) * g[w];
            self.s[w] = self.b2 * self.s[w] + (1.0 - self.b2) * (g[w] - self.m[w]).powi(2);

            let m_hat = self.m[w] / (1.0 - self.b1t);
            let s_hat = self.s[w] / (1.0 - self.b2t);

            let den_exact = (s_hat + self.eps_root).sqrt() + self.eps;

            x[w] -= self.lr * m_hat / den_exact;
        }

        self.b1t *= self.b1;
        self.b2t *= self.b2;
    }
}

#[allow(clippy::too_many_arguments)]
fn fit(
    steps: usize,
    types: &[FilterType],
    f0: &mut [f32],
    gain: &mut [f32],
    q_vals: &mut [f32],
    amp: &mut Option<f32>,
    f0_lim: &[Lim],
    gain_lim: &[Lim],
    q_lim: &[Lim],
    n_bands: usize,
    f: &[f32; K],
    r: &[f32; K],
    fs: f32,
) -> f32 {
    let mut lf_lim = [Lim { lo: 0.0, hi: 0.0 }; MAX_N];
    let mut bw_lim = [Lim { lo: 0.0, hi: 0.0 }; MAX_N];

    let max_f0 = 0.49 * fs;
    for n in 0..n_bands {
        lf_lim[n] = Lim {
            lo: f0_lim[n].lo.ln(),
            hi: f0_lim[n].hi.min(max_f0).ln(),
        };
        bw_lim[n] = Lim {
            lo: q_to_bw(q_lim[n].hi),
            hi: q_to_bw(q_lim[n].lo),
        };
    }

    let mut phi = [0.0; K];
    for k in 0..K {
        phi[k] = (std::f32::consts::PI / fs * f[k]).sin().powi(2);
    }

    let size = w_from_n(n_bands);
    let mut x = vec![0.0; size];

    {
        let (x_lf, x_rest) = x.split_at_mut(n_bands);
        let (x_gain, x_rest) = x_rest.split_at_mut(n_bands);
        let (x_bw, x_amp) = x_rest.split_at_mut(n_bands);

        for n in 0..n_bands {
            x_lf[n] = f0[n].min(max_f0).ln();
            x_gain[n] = gain[n];
            x_bw[n] = q_to_bw(q_vals[n]);
        }
        if let Some(a) = amp {
            x_amp[0] = *a;
        }
    }

    let mut g = vec![0.0; size];
    let mut best = x.clone();

    let c = Consts {
        types,
        phi: &phi,
        r,
        fs,
        n_bands,
        opt_amp: amp.is_some(),
    };

    let mut best_loss = grad(&c, &x, &mut g);

    let mut opt = AdaBelief::new(n_bands);

    for step in 0..steps {
        opt.lr = 0.03 * 0.5 * (1.0 + ((step as f32) / (steps as f32) * std::f32::consts::PI).cos());
        let loss = grad(&c, &x, &mut g);

        opt.step(&mut x, &g);

        let (x_lf, x_rest) = x.split_at_mut(n_bands);
        let (x_gain, x_rest) = x_rest.split_at_mut(n_bands);
        let (x_bw, _) = x_rest.split_at_mut(n_bands);

        for n in 0..n_bands {
            if limit(&mut x_lf[n], lf_lim[n]) {
                opt.m[n] = 0.0;
            }
            if limit(&mut x_gain[n], gain_lim[n]) {
                opt.m[n_bands + n] = 0.0;
            }
            if limit(&mut x_bw[n], bw_lim[n]) {
                opt.m[2 * n_bands + n] = 0.0;
            }
        }

        if loss.is_finite() && loss < best_loss {
            best_loss = loss;
            best.copy_from_slice(&x);
        }
    }

    let (best_lf, best_rest) = best.split_at(n_bands);
    let (best_gain, best_rest) = best_rest.split_at(n_bands);
    let (best_bw, best_amp) = best_rest.split_at(n_bands);

    for n in 0..n_bands {
        f0[n] = best_lf[n].exp().min(0.49 * fs);
        gain[n] = best_gain[n];
        q_vals[n] = bw_to_q(best_bw[n]);
    }

    if let Some(a) = amp {
        *a = best_amp[0];
    }

    best_loss
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

fn preprocess(
    f: &[f32; K],
    dst: &[f32; K],
    src: &[f32; K],
    r: &mut [f32; K],
    smooth: Option<&Smooth>,
    demean: bool,
) -> Result<f32, String> {
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

    let mut mean = 0.0;
    if demean {
        mean = center_mean(r);
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
    Ok(mean)
}

#[allow(clippy::too_many_arguments)]
fn run_autoeq_optimization(
    steps: usize,
    types: &[FilterType],
    f0: &mut [f32],
    gain: &mut [f32],
    q_vals: &mut [f32],
    amp: &mut Option<f32>,
    f0_lim: &[Lim],
    gain_lim: &[Lim],
    q_lim: &[Lim],
    n_bands: usize,
    f: &[f32; K],
    r: &[f32; K],
    fs: f32,
) -> f32 {
    let mut r_init = *r;

    for n in 0..n_bands {
        let type_val = types[n];
        let init_fn = match type_val {
            FilterType::Peak => init_pk,
            FilterType::LowShelf => init_lsc,
            FilterType::HighShelf => init_hsc,
            _ => init_pk,
        };

        let p = init_fn(&r_init, f, fs, f0_lim[n], gain_lim[n], q_lim[n]);
        let mut w = [0.0; K];
        spectrum_values(type_val, p.f0, -p.gain, p.q, fs, f, &mut w);
        for k in 0..K {
            r_init[k] += w[k];
        }

        f0[n] = p.f0;
        gain[n] = p.gain;
        q_vals[n] = p.q;
    }

    if let Some(a) = amp {
        *a = 0.0;
    }

    fit(
        steps, types, f0, gain, q_vals, amp, f0_lim, gain_lim, q_lim, n_bands, f, r, fs,
    )
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

pub fn run_autoeq(
    measurement_points: &[(f64, f64)],
    target_points: &[(f64, f64)],
    n_bands: usize,
    steps: usize,
    smooth_type: &str,
    fs: f32,
) -> Result<crate::eq::PEQData, String> {
    if n_bands == 0 || n_bands > MAX_N {
        return Err("Number of bands must be between 1 and 32".to_string());
    }
    validate_curve("Measurement", measurement_points)?;
    validate_curve("Target", target_points)?;
    if !fs.is_finite() || !(40_000.0..=768_000.0).contains(&fs) {
        return Err("Sample rate must be between 40000 and 768000 Hz".into());
    }
    if !matches!(
        smooth_type.to_ascii_lowercase().as_str(),
        "none" | "ie" | "oe"
    ) {
        return Err("Smoothing must be none, ie, or oe".into());
    }

    let steps = if steps == 0 { 3000 } else { steps.min(5000) };

    let f = generate_log_spaced_freqs();
    let src = interpolate_curve("Measurement", measurement_points, &f)?;
    let dst = interpolate_curve("Target", target_points, &f)?;

    let smooth = match smooth_type.to_lowercase().as_str() {
        "ie" => Some(&IE_SMOOTH),
        "oe" => Some(&OE_SMOOTH),
        _ => None,
    };

    let mut r = [0.0; K];
    let preamp_mean = preprocess(&f, &dst, &src, &mut r, smooth, true)?;

    let mut types = vec![crate::eq::FilterType::Peak; n_bands];
    if n_bands >= 1 {
        types[0] = crate::eq::FilterType::LowShelf;
    }
    if n_bands >= 2 {
        types[1] = crate::eq::FilterType::HighShelf;
    }

    let mut f0 = vec![1000.0; n_bands];
    for n in 0..n_bands {
        if types[n] == crate::eq::FilterType::LowShelf {
            f0[n] = 80.0;
        } else if types[n] == crate::eq::FilterType::HighShelf {
            f0[n] = 10000.0;
        }
    }
    let mut gain = vec![0.0; n_bands];
    let mut q_vals = vec![1.0; n_bands];

    let mut f0_lim = vec![
        Lim {
            lo: 20.0,
            hi: 16000.0
        };
        n_bands
    ];
    let gain_lim = vec![
        Lim {
            lo: -16.0,
            hi: 16.0
        };
        n_bands
    ];
    let mut q_lim = vec![Lim { lo: 0.4, hi: 4.0 }; n_bands];

    for n in 0..n_bands {
        if types[n] == crate::eq::FilterType::LowShelf {
            f0_lim[n] = Lim {
                lo: 20.0,
                hi: 500.0,
            };
            q_lim[n] = Lim { lo: 0.4, hi: 3.0 };
        } else if types[n] == crate::eq::FilterType::HighShelf {
            f0_lim[n] = Lim {
                lo: 3000.0,
                hi: 20000.0,
            };
            q_lim[n] = Lim { lo: 0.4, hi: 3.0 };
        }
    }

    let mut amp = Some(0.0);

    run_autoeq_optimization(
        steps,
        &types,
        &mut f0,
        &mut gain,
        &mut q_vals,
        &mut amp,
        &f0_lim,
        &gain_lim,
        &q_lim,
        n_bands,
        &f,
        &r,
        fs,
    );

    let mut filters = Vec::with_capacity(n_bands);
    for i in 0..n_bands {
        filters.push(crate::eq::Filter {
            index: i as u8,
            enabled: true,
            freq: f0[i].round() as u16,
            gain: gain[i] as f64,
            q: q_vals[i] as f64,
            filter_type: types[i],
        });
    }

    filters.sort_by_key(|f| f.freq);
    for (i, filter) in filters.iter_mut().enumerate() {
        filter.index = i as u8;
    }

    let mut response = [0.0f32; K];
    for filter in &filters {
        spectrum_values(
            filter.filter_type,
            filter.freq as f32,
            filter.gain as f32,
            filter.q as f32,
            fs,
            &f,
            &mut response,
        );
    }

    let mut max_gain = 0.0f32;
    for &val in response.iter() {
        if val > max_gain {
            max_gain = val;
        }
    }

    let total_preamp = preamp_mean + amp.unwrap_or(0.0);
    let preamp_val = if total_preamp + max_gain > 0.0 {
        -max_gain
    } else {
        total_preamp
    };
    let preamp = preamp_val as f64;

    Ok(crate::eq::PEQData {
        filters,
        global_gain: preamp,
    })
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

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    const MAX_BAND_GAIN: f64 = 10.0;

    // Generate a 2-decimal preamp in [-16, 6] that is always non-zero, so an
    // all-empty PEQ still survives parse_autoeq_text's "no filters & no preamp" Err.
    fn arb_preamp() -> impl Strategy<Value = f64> {
        (1i32..=2200).prop_map(|x| {
            if x <= 1600 {
                -(x as f64) / 100.0
            } else {
                ((x - 1600) as f64) / 100.0
            }
        })
    }

    fn arb_filter() -> impl Strategy<Value = Filter> {
        (
            any::<bool>(),
            20u16..=20000u16,   // freq
            -1000i32..=1000i32, // gain, 2-decimal steps
            100i32..=20000i32,  // q, 3-decimal steps
            0u8..=4u8,
        )
            .prop_map(|(enabled, freq, gain_h, q_t, ft)| Filter {
                index: 0,
                enabled,
                freq,
                gain: (gain_h as f64) / 100.0,
                q: (q_t as f64) / 1000.0,
                filter_type: match ft {
                    0 => FilterType::LowShelf,
                    1 => FilterType::Peak,
                    2 => FilterType::HighShelf,
                    3 => FilterType::HighPass,
                    _ => FilterType::LowPass,
                },
            })
    }

    // Content key ignoring index: round-trip compares as a multiset of filters.
    fn filter_key(f: &Filter) -> (u16, FilterType, i64, i64, bool) {
        (
            f.freq,
            f.filter_type,
            (f.gain * 100.0).round() as i64,
            (f.q * 1000.0).round() as i64,
            f.enabled,
        )
    }

    fn normalize(peq: &PEQData) -> Vec<(u16, FilterType, i64, i64, bool)> {
        let mut v: Vec<_> = peq.filters.iter().map(filter_key).collect();
        v.sort();
        v
    }

    proptest! {
        #[test]
        fn prop_peq_autoeq_roundtrip(
            filters in prop::collection::vec(arb_filter(), 0..=32),
            preamp in arb_preamp(),
        ) {
            let peq = PEQData {
                filters,
                global_gain: preamp,
            };
            let text = peq_to_autoeq(&peq);
            let (parsed, _, _warnings) = parse_autoeq_text(&text).unwrap();
            // Equal up to frequency re-sort and reindexing: compare as multiset.
            prop_assert_eq!(normalize(&peq), normalize(&parsed));
            // Preamp round-trips exactly (2-decimal precision).
            prop_assert!((parsed.global_gain - preamp).abs() < 1e-9);
        }
    }

    #[test]
    fn header_name_survives_expanding_lowercase() {
        // 'İ' lowercases to two chars; the name must still come from the
        // original casing, not a shifted lowered-copy offset.
        let text = "# xİgraphiceq:AB\nPreamp: -3 dB";
        let (peq, name, _) = parse_autoeq_text(text).unwrap();
        assert_eq!(name.as_deref(), Some("AB"));
        assert_eq!(peq.global_gain, -3.0);
    }

    #[test]
    fn out_of_range_index_does_not_poison_sequential_fill() {
        // A rejected explicit index must not advance the sequential cursor.
        let text = "Preamp: -3 dB\nFilter 9999: ON PK Fc 200 Hz Gain 1 dB Q 1.0\nFilter: ON PK Fc 300 Hz Gain 1 dB Q 1.0";
        let (peq, _, warnings) = parse_autoeq_text(text).unwrap();
        assert_eq!(peq.filters.len(), 1);
        assert_eq!(warnings.len(), 1);
        assert!(peq.filters.iter().any(|f| f.freq == 300));
    }

    #[test]
    fn unlabeled_filters_skip_occupied_indexes() {
        // "Filter 2" then "Filter 1" resets the sequential fill to 1; the
        // unlabeled line must take the next free slot, not clobber Filter 2.
        let text = "Preamp: -3 dB\nFilter 2: ON PK Fc 200 Hz Gain 1 dB Q 1.0\nFilter 1: ON PK Fc 100 Hz Gain 1 dB Q 1.0\nFilter: ON PK Fc 300 Hz Gain 1 dB Q 1.0";
        let (peq, _, warnings) = parse_autoeq_text(text).unwrap();
        assert_eq!(peq.filters.len(), 3);
        assert!(warnings.is_empty());
        assert!(peq.filters.iter().any(|f| f.freq == 300));
    }

    #[test]
    fn header_name_rejects_prefix_shorter_than_needle() {
        // Regression: a comment line shorter than the needle used to panic
        // on the slice after a truncated zip match.
        for text in [
            "# G\nPreamp: -3 dB",
            "# A",
            "# GraphicEQ",
            "# xİgraphiceq:AB",
        ] {
            let _ = parse_autoeq_text(text);
        }
        let (peq, name, _) = parse_autoeq_text("# GraphicEQ:Flat\nPreamp: -3 dB").unwrap();
        assert_eq!(name.as_deref(), Some("Flat"));
        assert_eq!(peq.global_gain, -3.0);
    }
    #[test]
    fn parses_and_log_normalizes_curve() {
        let points =
            parse_curve_text("# frequency response\n20, 5, ignored\n100 10\n10000;20\n// footer")
                .unwrap();
        assert_eq!(points.len(), 3);
        assert!((interpolate_point(&points, 1000.0)).abs() < 1e-9);
        assert!(parse_curve_text("header\n10,2\n20,3").is_err());
    }

    #[test]
    fn curve_normalization_rejects_finite_values_that_overflow() {
        let text = format!("20 {}\n20000 {}", f64::MAX, -f64::MAX);
        assert!(parse_curve_text(&text).is_err());
    }

    #[test]
    fn autoeq_rejects_finite_values_that_overflow_f32_conversion() {
        let extreme = [(20.0, f64::MAX), (20_000.0, f64::MAX)];
        let flat = [(20.0, 0.0), (20_000.0, 0.0)];
        assert!(run_autoeq(&extreme, &flat, 2, 10, "none", 48_000.0).is_err());
    }

    #[test]
    fn autoeq_rejects_finite_values_that_overflow_residual() {
        let high = f32::MAX as f64;
        let measurement = [(20.0, high), (20_000.0, high)];
        let target = [(20.0, -high), (20_000.0, -high)];
        assert!(run_autoeq(&measurement, &target, 2, 10, "none", 48_000.0).is_err());
    }

    #[test]
    fn autoeq_rejects_invalid_public_inputs() {
        let curve = [(20.0, 0.0), (20_000.0, 0.0)];
        assert!(run_autoeq(&[], &curve, 2, 10, "none", 48_000.0).is_err());
        assert!(run_autoeq(&curve, &curve, 2, 10, "bad", 48_000.0).is_err());
        assert!(run_autoeq(&curve, &curve, 2, 10, "none", f32::NAN).is_err());
    }

    #[test]
    fn autoeq_preamp_prevents_clipping() {
        let measurement = [
            (20.0, 0.0),
            (100.0, 0.0),
            (500.0, 0.0),
            (1000.0, 0.0),
            (2000.0, 0.0),
            (5000.0, 0.0),
            (10000.0, 0.0),
            (20000.0, 0.0),
        ];
        let mut target = measurement;
        target[3].1 = 12.0;
        let peq = run_autoeq(&measurement, &target, 5, 100, "none", 48_000.0).unwrap();
        assert!(peq.global_gain < 0.0);
    }

    #[test]
    fn rejects_overflowing_preamp_and_filter_values() {
        let overflow = "9".repeat(400);
        let text = format!(
            "Preamp: {overflow} dB\n\
             Filter 1: ON PK Fc 100 Hz Gain {overflow} dB Q 1.0\n\
             Filter 2: ON PK Fc 200 Hz Gain 1.0 dB Q {overflow}\n\
             Filter 3: ON PK Fc 300 Hz Gain 1.0 dB Q 1.0"
        );

        let (peq, _, warnings) = parse_autoeq_text(&text).unwrap();

        assert_eq!(peq.global_gain, 0.0);
        assert_eq!(peq.filters.len(), 1);
        assert_eq!(peq.filters[0].freq, 300);
        assert_eq!(warnings.len(), 3);
    }

    #[test]
    fn rejects_zero_and_negative_q() {
        let text = "Preamp: -3 dB\n\
                    Filter 1: ON PK Fc 100 Hz Gain 1.0 dB Q 0\n\
                    Filter 2: ON PK Fc 200 Hz Gain 1.0 dB Q -1\n\
                    Filter 3: ON PK Fc 300 Hz Gain 1.0 dB Q 0.5";

        let (peq, _, warnings) = parse_autoeq_text(text).unwrap();

        assert_eq!(peq.filters.len(), 1);
        assert_eq!(peq.filters[0].freq, 300);
        assert_eq!(warnings.len(), 2);
    }

    #[test]
    fn test_parse_autoeq_with_preamp() {
        let text = "Preamp: -3 dB\nFilter 1: ON PK Fc 100 Hz Gain 5.0 dB Q 1.0";
        let (result, name, warnings) = parse_autoeq_text(text).unwrap();
        assert_eq!(result.global_gain, -3.0);
        assert!(result.filters[0].enabled);
        assert!(warnings.is_empty());
        assert_eq!(name, None);
    }

    #[test]
    fn test_parse_autoeq_multiple_filters() {
        let text = "Filter 1: ON PK Fc 100 Hz Gain 5.0 dB Q 1.0\nFilter 2: OFF PK Fc 1000 Hz Gain 0 dB Q 2.0";
        let (result, _, warnings) = parse_autoeq_text(text).unwrap();
        assert!(result.filters[0].enabled);
        assert!(!result.filters[1].enabled);
        assert!(warnings.is_empty());
    }

    #[test]
    fn test_peq_to_autoeq_format() {
        let peq = PEQData {
            filters: vec![Filter::enabled(0, true)],
            global_gain: -3.0,
        };
        let output = peq_to_autoeq(&peq);
        assert!(output.contains("Preamp: -3 dB"));
        assert!(output.contains("Filter 1: ON"));

        let peq_one_dec = PEQData {
            filters: vec![],
            global_gain: -3.5,
        };
        assert!(peq_to_autoeq(&peq_one_dec).contains("Preamp: -3.5 dB"));

        let peq_two_dec = PEQData {
            filters: vec![],
            global_gain: -3.55,
        };
        assert!(peq_to_autoeq(&peq_two_dec).contains("Preamp: -3.55 dB"));
    }

    #[test]
    fn negative_zero_preamp_round_trips() {
        let peq = PEQData {
            filters: vec![],
            global_gain: -0.004,
        };
        let text = peq_to_autoeq(&peq);
        assert!(text.contains("Preamp: 0 dB"), "got: {text}");
        let (parsed, _, _) = parse_autoeq_text(&text).unwrap();
        assert_eq!(parsed.global_gain, 0.0);
    }

    #[test]
    fn test_parse_autoeq_clamp_gain() {
        let text = "Filter 1: ON PK Fc 100 Hz Gain 20.0 dB Q 1.0";
        let (mut result, _, warnings) = parse_autoeq_text(text).unwrap();

        result.clamp_to_capabilities(&crate::device::capabilities::DESKTOP_DAC_CAPS);

        assert_eq!(result.filters[0].gain, MAX_BAND_GAIN);
        assert!(warnings.is_empty());
    }

    #[test]
    fn test_parse_real_file_format() {
        let text = "Preamp: -6.3 dB\nFilter 1: ON LSC Fc 36 Hz Gain -2.22 dB Q 0.857\nFilter 2: ON PK Fc 166 Hz Gain -0.79 dB Q 1.669";
        let (result, _, warnings) = parse_autoeq_text(text).unwrap();
        assert_eq!(result.global_gain, -6.3);
        assert_eq!(result.filters[0].freq, 36);
        assert!((result.filters[0].gain - (-2.22)).abs() < 0.1);
        assert_eq!(result.filters[0].filter_type, FilterType::LowShelf);
        assert_eq!(result.filters[1].filter_type, FilterType::Peak);
        assert!(warnings.is_empty());
    }

    #[test]
    fn test_parse_user_clipboard_shelf_types() {
        let text = "Preamp: -6.5 dB
Filter 1: ON PK Fc 22 Hz Gain -0.86 dB Q 1.717
Filter 2: ON LSC Fc 43 Hz Gain -1.38 dB Q 1.004
Filter 8: ON HSC Fc 7624 Hz Gain 0.59 dB Q 3.000";
        let (result, _, _) = parse_autoeq_text(text).unwrap();
        assert_eq!(result.filters[0].filter_type, FilterType::Peak);
        assert_eq!(result.filters[1].filter_type, FilterType::LowShelf);
        assert_eq!(result.filters[2].filter_type, FilterType::HighShelf);
    }

    #[test]
    fn test_round_trip_shelf_preserves_type() {
        let original = PEQData {
            filters: vec![
                Filter {
                    index: 0,
                    enabled: true,
                    freq: 80,
                    gain: -2.0,
                    q: 0.7,
                    filter_type: FilterType::LowShelf,
                },
                Filter {
                    index: 1,
                    enabled: true,
                    freq: 8000,
                    gain: 1.0,
                    q: 0.7,
                    filter_type: FilterType::HighShelf,
                },
            ],
            global_gain: 0.0,
        };
        let text = peq_to_autoeq(&original);
        let (parsed, _, _) = parse_autoeq_text(&text).unwrap();
        assert_eq!(parsed.filters[0].filter_type, FilterType::LowShelf);
        assert_eq!(parsed.filters[1].filter_type, FilterType::HighShelf);
    }

    #[test]
    fn test_parse_legacy_ls_hs_tokens() {
        let text =
            "Filter 1: ON LS Fc 80 Hz Gain -2 dB Q 0.7\nFilter 2: ON HS Fc 8000 Hz Gain 1 dB Q 0.7";
        let (result, _, _) = parse_autoeq_text(text).unwrap();
        assert_eq!(result.filters[0].filter_type, FilterType::LowShelf);
        assert_eq!(result.filters[1].filter_type, FilterType::HighShelf);
    }

    #[test]
    fn test_parse_full_name_filter_types() {
        let text = "Filter 1: ON LowShelf Fc 80 Hz Gain -2 dB Q 0.7
Filter 2: ON HighShelf Fc 8000 Hz Gain 1 dB Q 0.7
Filter 3: ON HighPass Fc 20 Hz Gain 0 dB Q 0.7
Filter 4: ON LowPass Fc 18000 Hz Gain 0 dB Q 0.7";
        let (result, _, _) = parse_autoeq_text(text).unwrap();
        // Filters are sorted by frequency
        assert_eq!(result.filters[0].freq, 20);
        assert_eq!(result.filters[0].filter_type, FilterType::HighPass);
        assert_eq!(result.filters[1].freq, 80);
        assert_eq!(result.filters[1].filter_type, FilterType::LowShelf);
        assert_eq!(result.filters[2].freq, 8000);
        assert_eq!(result.filters[2].filter_type, FilterType::HighShelf);
        assert_eq!(result.filters[3].freq, 18000);
        assert_eq!(result.filters[3].filter_type, FilterType::LowPass);
    }

    #[test]
    fn test_parse_autoeq_lenient_with_bad_lines() {
        let text = "Preamp: -3 dB\nFilter 1: ON PK Fc 100 Hz Gain 5.0 dB Q 1.0\nFilter 2: BAD FORMAT\nFilter 3: OFF PK Fc 1000 Hz Gain 0 dB Q 2.0";
        let (result, _, warnings) = parse_autoeq_text(text).unwrap();
        assert_eq!(result.filters[0].freq, 100);
        assert_eq!(result.filters[1].freq, 1000);
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("Failed to parse"));
    }

    #[test]
    fn test_parse_lsq_missing_q_fallback() {
        // Shelf type with missing Q should default to 1.0 rather than failing
        let text = "Filter 1: ON LSQ Fc 80 Hz Gain -3.0 dB";
        let (result, _, _) = parse_autoeq_text(text).unwrap();
        assert_eq!(result.filters[0].q, 1.0);
    }

    #[test]
    fn test_parse_inline_comments() {
        let text = "Preamp: -3 dB # Set preamplifier gain\nFilter 1: ON PK Fc 1000 Hz Gain 1.5 dB Q 1.4 # peak filter";
        let (result, _, _) = parse_autoeq_text(text).unwrap();
        assert_eq!(result.global_gain, -3.0);
        assert_eq!(result.filters[0].freq, 1000);
        assert!((result.filters[0].gain - 1.5).abs() < 0.01);
        assert!((result.filters[0].q - 1.4).abs() < 0.01);
    }

    #[test]
    fn test_parse_number_after_case_insensitive_fallback() {
        // Test case-insensitive fallback logic inside extract_number_after
        let text = "Filter 1: ON PK fc 500 gain 2.0 q 1.2";
        let (result, _, _) = parse_autoeq_text(text).unwrap();
        assert_eq!(result.filters[0].freq, 500);
        assert!((result.filters[0].gain - 2.0).abs() < 0.01);
        assert!((result.filters[0].q - 1.2).abs() < 0.01);
    }

    #[test]
    fn test_parse_oversized_filter_index_dos_mitigation() {
        let text = "Filter 1: ON PK Fc 100 Hz Gain 1.0 dB Q 1.0\nFilter 9999: ON PK Fc 1000 Hz Gain 2.0 dB Q 1.0";
        let (result, _, warnings) = parse_autoeq_text(text).unwrap();
        assert_eq!(result.filters.len(), 1); // Should only have Filter 1
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("exceeds maximum allowed bands"));
    }

    #[test]
    fn test_parse_index_less_filters() {
        let text = "Preamp: -6.0 dB\nFilter: ON PK Fc 30 Hz Gain 6.0 dB Q 1.5\nFilter: ON PK Fc 100 Hz Gain -3.0 dB Q 2.0";
        let (result, name, warnings) = parse_autoeq_text(text).unwrap();
        assert_eq!(result.global_gain, -6.0);
        assert_eq!(result.filters.len(), 2);
        assert!(result.filters[0].enabled);
        assert_eq!(result.filters[0].freq, 30);
        assert_eq!(result.filters[1].freq, 100);
        assert!(warnings.is_empty());
        assert_eq!(name, None);
    }

    #[test]
    fn test_parse_headphone_name_from_comments() {
        let text = "# GraphicEQ: Sennheiser HD 600\nPreamp: -3 dB\nFilter 1: ON PK Fc 100 Hz Gain 5.0 dB Q 1.0";
        let (_, name, _) = parse_autoeq_text(text).unwrap();
        assert_eq!(name, Some("Sennheiser HD 600".to_string()));

        let text2 = "# Sennheiser HD 600\nPreamp: -3 dB";
        let (_, name2, _) = parse_autoeq_text(text2).unwrap();
        assert_eq!(name2, Some("Sennheiser HD 600".to_string()));
    }

    #[test]
    fn test_parse_unicode_header_no_panic() {
        // 'İ' lowercases to two chars, shifting byte offsets between the
        // lowered copy and the original; slicing by lowered byte offset used
        // to panic. Casing of the extracted name must be preserved.
        let text = "# İ: graphiceq: Sennheiser HD 600\nFilter 1: ON PK Fc 100 Hz Gain 5 dB Q 1.0";
        let (_, name, _) = parse_autoeq_text(text).unwrap();
        assert_eq!(name.as_deref(), Some("Sennheiser HD 600"));
    }

    #[test]
    fn test_autoeq_nyquist_clamping_and_accumulation_stability() {
        let measurement = [(20.0, 0.0), (20_000.0, 0.0)];
        let target = [(20.0, 5.0), (20_000.0, -5.0)];
        let result = run_autoeq(&measurement, &target, 10, 50, "none", 44_100.0).unwrap();
        for filter in &result.filters {
            assert!((filter.freq as f32) <= 0.49 * 44_100.0);
            assert!(filter.gain.is_finite());
            assert!(filter.q.is_finite());
        }
    }
}
