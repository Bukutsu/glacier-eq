// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

use crate::{Filter, FilterType, PEQData};

pub fn parse_autoeq_text(text: &str) -> Result<(PEQData, Option<String>, Vec<String>), String> {
    let lines: Vec<&str> = text.lines().collect();
    let mut filters: std::collections::BTreeMap<usize, Filter> = std::collections::BTreeMap::new();
    let mut preamp: i8 = 0;
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
            if let Some(m) = extract_number(line) {
                // Preamp is unbounded here, will be clamped later
                preamp = m.round() as i8;
            } else {
                warnings.push(format!("Line {}: Failed to parse preamp value", line_num));
            }
            continue;
        }

        if line.to_lowercase().contains("filter") {
            if let Some(parsed) = parse_filter_line(line) {
                let idx = parsed.index.unwrap_or_else(|| {
                    let i = next_sequential_idx;
                    next_sequential_idx += 1;
                    i
                });

                if parsed.index.is_some() {
                    next_sequential_idx = idx + 1;
                }

                if idx >= 32 {
                    warnings.push(format!(
                        "Line {}: Filter index {} exceeds maximum allowed bands (32)",
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
                        freq: parsed.freq as u16,
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

    if parsed_count == 0 && preamp == 0 {
        return Err("No valid filters or preamp found in AutoEQ text".into());
    }

    // Convert BTreeMap to a contiguous Vec<Filter>, padding missing indices with disabled filters
    let max_idx = filters.keys().max().copied().unwrap_or(0);
    let mut contiguous_filters = Vec::with_capacity(max_idx + 1);
    for i in 0..=max_idx {
        if let Some(f) = filters.remove(&i) {
            contiguous_filters.push(f);
        } else {
            contiguous_filters.push(Filter::enabled(i as u8, false));
        }
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

            // Check for explicit headers
            if let Some(pos) = content.to_lowercase().find("graphiceq:") {
                let name = content[pos + 10..].trim();
                if !name.is_empty() {
                    return Some(name.to_string());
                }
            }
            if let Some(pos) = content.to_lowercase().find("autoeq:") {
                let name = content[pos + 7..].trim();
                if !name.is_empty() {
                    return Some(name.to_string());
                }
            }

            // Or if it's the first non-empty comment line and doesn't look like a URL or generic info
            let lower = content.to_lowercase();
            if !lower.contains("http")
                && !lower.contains("squig.link")
                && !lower.contains("equalizer")
                && !lower.contains("preamp")
                && !lower.contains("filter")
                && !lower.contains("frequency")
                && !lower.contains("response")
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
    let lower = line.to_lowercase();
    let filter_idx = lower.find("filter")?;
    let rest = &line[filter_idx + 6..];

    let mut digits = String::new();
    let mut found_digit = false;
    for c in rest.chars() {
        if c.is_ascii_digit() {
            digits.push(c);
            found_digit = true;
        } else if found_digit {
            break;
        } else if c.is_whitespace() {
            // Skip leading whitespace before finding a digit
            continue;
        } else if c == ':' {
            // If we hit a colon before finding any digit, e.g. "Filter: ON"
            break;
        } else {
            // Any other non-digit character before finding a digit means it's not a standard index
            break;
        }
    }

    let idx: Option<usize> = if digits.is_empty() {
        None
    } else {
        let i: usize = digits.parse().ok()?;
        Some(i.saturating_sub(1))
    };

    let on_off = !lower.contains("off");
    let rest_upper = rest.to_uppercase();

    let filter_type = if contains_token(&rest_upper, "LSC") || contains_token(&rest_upper, "LSQ") {
        FilterType::LowShelf
    } else if contains_token(&rest_upper, "HSC") || contains_token(&rest_upper, "HSQ") {
        FilterType::HighShelf
    } else if contains_token(&rest_upper, "HP") || contains_token(&rest_upper, "HPF") {
        FilterType::HighPass
    } else if contains_token(&rest_upper, "LP") || contains_token(&rest_upper, "LPF") {
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
    let lower = s.to_lowercase();
    let keyword_lower = keyword.to_lowercase();
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
        return extract_number(&s[actual_pos + keyword.len()..]);
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
    let mut lines = vec![format!("Preamp: {} dB", peq.global_gain)];

    for (i, f) in peq.filters.iter().enumerate() {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MAX_BAND_GAIN;

    #[test]
    fn test_parse_autoeq_with_preamp() {
        let text = "Preamp: -3 dB\nFilter 1: ON PK Fc 100 Hz Gain 5.0 dB Q 1.0";
        let (result, name, warnings) = parse_autoeq_text(text).unwrap();
        assert_eq!(result.global_gain, -3);
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
            global_gain: -3,
        };
        let output = peq_to_autoeq(&peq);
        assert!(output.contains("Preamp: -3 dB"));
        assert!(output.contains("Filter 1: ON"));
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
        assert_eq!(result.global_gain, -6);
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
        assert_eq!(result.filters[7].filter_type, FilterType::HighShelf);
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
            global_gain: 0,
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
    fn test_parse_autoeq_lenient_with_bad_lines() {
        let text = "Preamp: -3 dB\nFilter 1: ON PK Fc 100 Hz Gain 5.0 dB Q 1.0\nFilter 2: BAD FORMAT\nFilter 3: OFF PK Fc 1000 Hz Gain 0 dB Q 2.0";
        let (result, _, warnings) = parse_autoeq_text(text).unwrap();
        assert_eq!(result.filters[0].freq, 100);
        assert_eq!(result.filters[2].freq, 1000);
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
        assert_eq!(result.global_gain, -3);
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
        assert_eq!(result.global_gain, -6);
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
}
