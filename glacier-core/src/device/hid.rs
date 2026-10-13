// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! HID report sizes are payload bits, excluding the report ID byte. Endpoint
//! packet sizes describe USB transfers and must never be used as report sizes.
use super::{DeviceProtocol, EqProtocol};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReportDescriptor {
    pub input_bits: BTreeMap<u8, u32>,
    pub output_bits: BTreeMap<u8, u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReportContract {
    pub report_id: u8,
    pub min_output_bytes: usize,
    pub min_input_bytes: usize,
}

impl ReportContract {
    pub fn for_protocol(protocol: DeviceProtocol) -> Result<Self, String> {
        // Use the protocol's report ID, including per-model FiiO variants. The
        // minima come from the longest commands and consumed response fields.
        let (min_output_bytes, min_input_bytes) = match protocol {
            DeviceProtocol::Unknown => return Err("Unknown HID protocol".into()),
            DeviceProtocol::Moondrop => (63, 34),
            DeviceProtocol::Walkplay => (36, 34),
            DeviceProtocol::FiioJa11 | DeviceProtocol::Fiio | DeviceProtocol::FiioKa17 => (16, 16), // FiiO filter write / filter response
        };
        Ok(Self {
            report_id: protocol.report_id(),
            min_output_bytes,
            min_input_bytes,
        })
    }

    pub fn validate(self, descriptor: &[u8]) -> Result<ReportDescriptor, String> {
        let reports = parse_report_descriptor(descriptor)?;
        for (direction, sizes, minimum) in [
            ("Output", &reports.output_bits, self.min_output_bytes),
            ("Input", &reports.input_bits, self.min_input_bytes),
        ] {
            if minimum == 0 {
                continue;
            }
            let bits = sizes.get(&self.report_id).ok_or_else(|| {
                format!(
                    "HID collection has no {direction} report ID 0x{:02X}",
                    self.report_id
                )
            })?;
            let minimum_bits = minimum
                .checked_mul(8)
                .ok_or("HID report minimum overflow")?;
            if u64::from(*bits) < minimum_bits as u64 {
                return Err(format!(
                    "HID {direction} report ID 0x{:02X} is too short: {bits} bits; requires at least {minimum} payload bytes",
                    self.report_id
                ));
            }
        }
        Ok(reports)
    }
}

#[derive(Clone, Copy, Default)]
struct Globals {
    size: u32,
    count: u32,
    id: u8,
}

pub fn parse_report_descriptor(bytes: &[u8]) -> Result<ReportDescriptor, String> {
    if bytes.is_empty() {
        return Err("Empty HID report descriptor".into());
    }
    let mut reports = ReportDescriptor::default();
    let mut globals = Globals::default();
    let mut stack = Vec::new();
    let mut offset = 0;
    let mut collections = 0usize;
    let mut numbered = false;
    let mut unnumbered = false;
    while offset < bytes.len() {
        let start = offset;
        let prefix = bytes[offset];
        offset += 1;
        if prefix == 0xFE {
            let header = bytes
                .get(offset..offset + 2)
                .ok_or_else(|| format!("Truncated HID long item at {start}"))?;
            let length = usize::from(header[0]);
            offset += 2;
            bytes
                .get(offset..offset + length)
                .ok_or_else(|| format!("Truncated HID long item payload at {start}"))?;
            offset += length;
            continue;
        }
        let length = match prefix & 3 {
            3 => 4,
            n => usize::from(n),
        };
        let data = bytes
            .get(offset..offset + length)
            .ok_or_else(|| format!("Truncated HID short item at {start}"))?;
        offset += length;
        let value = data
            .iter()
            .enumerate()
            .fold(0u32, |v, (i, b)| v | (u32::from(*b) << (i * 8)));
        let kind = (prefix >> 2) & 3;
        let tag = prefix >> 4;
        match (kind, tag) {
            (1, 7 | 9) => {
                if length == 0 {
                    return Err(format!("Missing HID report size/count at {start}"));
                }
                if tag == 7 {
                    globals.size = value;
                } else {
                    globals.count = value;
                }
            }
            (1, 8) => {
                if length != 1 || value == 0 {
                    return Err(format!(
                        "Invalid HID report ID at {start}: explicit IDs must be 1..255"
                    ));
                }
                globals.id = value as u8;
            }
            (1, 10) => {
                if length != 0 {
                    return Err(format!("Invalid HID global Push at {start}"));
                }
                stack.push(globals);
            }
            (1, 11) => {
                if length != 0 {
                    return Err(format!("Invalid HID global Pop at {start}"));
                }
                globals = stack
                    .pop()
                    .ok_or_else(|| format!("HID global Pop without Push at {start}"))?;
            }
            (0, 10) => {
                if length != 1 {
                    return Err(format!("Invalid HID Collection at {start}"));
                }
                collections += 1;
            }
            (0, 12) => {
                if length != 0 || collections == 0 {
                    return Err(format!("Unmatched HID End Collection at {start}"));
                }
                collections -= 1;
            }
            (0, 8 | 9 | 11) => {
                if length == 0 || globals.size == 0 || globals.count == 0 {
                    return Err(format!(
                        "HID report has missing/zero size or count at {start}"
                    ));
                }
                numbered |= globals.id != 0;
                unnumbered |= globals.id == 0;
                if numbered && unnumbered {
                    return Err("HID descriptor mixes numbered and unnumbered reports".into());
                }
                let bits = globals
                    .size
                    .checked_mul(globals.count)
                    .ok_or("HID report bit size overflow")?;
                if tag != 11 {
                    let sizes = if tag == 8 {
                        &mut reports.input_bits
                    } else {
                        &mut reports.output_bits
                    };
                    let total = sizes.entry(globals.id).or_default();
                    *total = total
                        .checked_add(bits)
                        .ok_or("HID report bit size overflow")?;
                }
            }
            _ => {} // Other globals and local usages do not affect lengths.
        }
    }
    if !stack.is_empty() || collections != 0 {
        return Err("Unbalanced HID globals/collections".into());
    }
    if reports.input_bits.is_empty() && reports.output_bits.is_empty() {
        return Err("HID descriptor has no Input or Output reports".into());
    }
    Ok(reports)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(id: u8, output: u8, input: u8) -> Vec<u8> {
        let mut bytes = vec![0x06, 0x00, 0xff, 0x09, 1, 0xa1, 1];
        if id != 0 {
            bytes.extend_from_slice(&[0x85, id]);
        }
        bytes.extend_from_slice(&[0x75, 8, 0x95, output, 0x91, 2, 0x95, input, 0x81, 2, 0xc0]);
        bytes
    }
    #[test]
    fn validates_protocol_fixtures_and_larger_reports() {
        for protocol in [
            DeviceProtocol::Moondrop,
            DeviceProtocol::Walkplay,
            DeviceProtocol::FiioJa11,
            DeviceProtocol::Fiio,
            DeviceProtocol::FiioKa17,
        ] {
            let contract = ReportContract::for_protocol(protocol).unwrap();
            contract
                .validate(&fixture(
                    contract.report_id,
                    contract.min_output_bytes as u8,
                    contract.min_input_bytes as u8,
                ))
                .unwrap();
            contract
                .validate(&fixture(contract.report_id, 64, 64))
                .unwrap();
        }
    }
    #[test]
    fn rejects_missing_wrong_and_short_reports() {
        let contract = ReportContract {
            report_id: 0x4b,
            min_output_bytes: 63,
            min_input_bytes: 34,
        };
        assert!(contract.validate(&[]).unwrap_err().contains("Empty"));
        assert!(contract
            .validate(&fixture(2, 63, 34))
            .unwrap_err()
            .contains("no Output"));
        assert!(contract
            .validate(&fixture(0x4b, 62, 34))
            .unwrap_err()
            .contains("Output"));
        assert!(contract
            .validate(&fixture(0x4b, 63, 33))
            .unwrap_err()
            .contains("Input"));
        assert!(contract
            .validate(&[0x85, 0x4b, 0x75, 8, 0x95, 63, 0x91, 2])
            .unwrap_err()
            .contains("no Input"));
    }
    #[test]
    fn sums_fields_and_restores_size_count_and_id_on_pop() {
        let bytes = [
            0x85, 1, 0x75, 3, 0x95, 2, 0x91, 1, 0xa4, 0x85, 2, 0x75, 8, 0x95, 4, 0x81, 2, 0xb4,
            0x91, 1,
        ];
        let reports = parse_report_descriptor(&bytes).unwrap();
        assert_eq!(reports.output_bits.get(&1), Some(&12));
        assert_eq!(reports.input_bits.get(&2), Some(&32));
        let contract = ReportContract {
            report_id: 1,
            min_output_bytes: 2,
            min_input_bytes: 0,
        };
        assert!(contract.validate(&bytes).unwrap_err().contains("too short"));
    }
    #[test]
    fn unnumbered_reports_exclude_the_hidapi_zero_prefix() {
        let contract = ReportContract {
            report_id: 0,
            min_output_bytes: 63,
            min_input_bytes: 34,
        };
        let reports = contract.validate(&fixture(0, 63, 34)).unwrap();
        assert_eq!(reports.output_bits.get(&0), Some(&504));
        assert!(parse_report_descriptor(&[0x85, 0]).is_err());
        assert!(parse_report_descriptor(&[0x75, 8, 0x95, 1, 0x81, 2, 0x85, 1, 0x91, 2]).is_err());
    }
    #[test]
    fn bounds_short_and_long_items_and_accepts_valid_long_items() {
        for bytes in [
            &[0x77, 1, 2][..],
            &[0xfe][..],
            &[0xfe, 2][..],
            &[0xfe, 2, 0x99, 1][..],
        ] {
            assert!(parse_report_descriptor(bytes).is_err());
        }
        let mut bytes = vec![0xfe, 2, 0x99, 1, 2];
        bytes.extend_from_slice(&fixture(1, 63, 34));
        assert!(parse_report_descriptor(&bytes).is_ok());
        // Every truncated prefix of a real collection is rejected.
        let complete = fixture(1, 63, 34);
        for end in 0..complete.len() {
            assert!(
                parse_report_descriptor(&complete[..end]).is_err(),
                "prefix {end}"
            );
        }
    }
    #[test]
    fn rejects_unbalanced_and_zero_globals_and_checked_overflow() {
        for bytes in [
            &[0xb4][..],
            &[0xa4][..],
            &[0xc0][..],
            &[0xa1, 1][..],
            &[0x75, 0, 0x95, 1, 0x81, 2][..],
            &[0x75, 8, 0x95, 0, 0x91, 2][..],
            &[0x75, 8, 0x95, 1, 0x81][..],
        ] {
            assert!(parse_report_descriptor(bytes).is_err());
        }
        let multiply = [0x77, 0xff, 0xff, 0xff, 0xff, 0x95, 2, 0x81, 2];
        assert!(parse_report_descriptor(&multiply)
            .unwrap_err()
            .contains("overflow"));
        let add = [0x77, 0xff, 0xff, 0xff, 0xff, 0x95, 1, 0x81, 2, 0x81, 2];
        assert!(parse_report_descriptor(&add)
            .unwrap_err()
            .contains("overflow"));
    }
    #[test]
    fn separates_multiple_report_ids_and_handles_wide_counts_and_nested_globals() {
        let bytes = [
            0x85, 1, 0x75, 8, 0x96, 0, 1, 0x91, 2, // ID 1: 256 bytes
            0xa4, 0x85, 2, 0x95, 3, 0x81, 2, // ID 2: 3 bytes
            0xa4, 0x85, 3, 0x75, 1, 0x95, 5, 0x91, 1, 0xb4, 0x91,
            2, // restores ID 2, size 8, count 3
            0xb4, 0x81, 2, // restores ID 1, size 8, count 256
        ];
        let reports = parse_report_descriptor(&bytes).unwrap();
        assert_eq!(reports.input_bits, BTreeMap::from([(1, 2048), (2, 24)]));
        assert_eq!(
            reports.output_bits,
            BTreeMap::from([(1, 2048), (2, 24), (3, 5)])
        );
    }

    proptest::proptest! {
        #[test]
        fn arbitrary_descriptors_never_panic(bytes in proptest::collection::vec(proptest::prelude::any::<u8>(), 0..4097)) {
            let _ = parse_report_descriptor(&bytes);
        }
        #[test]
        fn accumulates_fields_without_rounding_each_field(fields in proptest::collection::vec((1u8..33, 1u8..128), 1..64)) {
            let mut descriptor = vec![0x85, 1];
            let mut expected = 0u32;
            for (size, count) in fields {
                descriptor.extend_from_slice(&[0x75, size, 0x95, count, 0x91, 1]);
                expected += u32::from(size) * u32::from(count);
            }
            let reports = parse_report_descriptor(&descriptor).unwrap();
            proptest::prop_assert_eq!(reports.output_bits.get(&1), Some(&expected));
        }
    }
}
