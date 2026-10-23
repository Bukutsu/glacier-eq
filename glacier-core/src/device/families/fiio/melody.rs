// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! SNOWSKY Melody controls (`Controls::Melody`): the active EQ preset and the
//! firmware version. Both are what FiiO Control Web itself reads and writes for
//! this model (https://fiiocontrol.fiio.com/, bundle index-7hb30NUo.js):
//! - preset: command 0x16, one byte. Values are the web app's Melody list:
//!   0..6 factory (Jazz, Pop, Rock, Dance, R&B, Classic, Hip-hop), 160..162
//!   USER1..3, 240 EQ off.
//! - firmware: command 0x0b, reply payload bytes joined with "." as the web
//!   app's repair page shows them.
//!
//! The web app also sends a sequence number and CRC-8 in each request. A live
//! Melody answered requests that carry zeros there (the same framing as the
//! EQ packets), so zeros are kept. Nothing here saves; selecting a preset does
//! not touch stored band data.

use crate::device::Packet;

const REPORT_ID: u8 = 7;
const END: u8 = 0xEE;
const PRESET: u8 = 0x16;
const FIRMWARE: u8 = 0x0B;

/// Preset ids FiiO Control Web offers for the Melody, in display order.
pub const PRESETS: [u8; 11] = [0, 1, 2, 3, 4, 5, 6, 160, 161, 162, 240];

fn read(command: u8) -> Packet {
    Packet::new(REPORT_ID, vec![0xBB, 0x0B, 0, 0, command, 0, 0, END])
}

// Independently implemented from Contour's published hardware findings:
// https://github.com/Chronosauros/contour/blob/81cd09dbad630c4237355334a9b4a86d2e1a1f63/research/protocol/PROTOCOL.md
// Names use the preset id, not a KA15-style position index.
pub fn require_user_slot(slot: u8) -> Result<(), String> {
    if (160..=162).contains(&slot) {
        Ok(())
    } else {
        Err(format!("Not a Melody USER slot: {slot}"))
    }
}

pub fn save_request(slot: u8) -> Result<Packet, String> {
    require_user_slot(slot)?;
    Ok(Packet::new(
        REPORT_ID,
        vec![0xaa, 0x0a, 0, 0, 0x19, 1, slot, 0, END],
    ))
}

pub fn name_request(slot: u8) -> Result<Packet, String> {
    require_user_slot(slot)?;
    Ok(Packet::new(
        REPORT_ID,
        vec![0xbb, 0x0b, 0, 0, 0x30, 1, slot, 0, END],
    ))
}

pub fn normalize_name(name: &str) -> Result<String, String> {
    if name.is_empty() || name.len() > 8 || !name.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err("Melody names need 1–8 ASCII letters or digits".into());
    }
    Ok(name.to_ascii_uppercase())
}

pub fn name_write(slot: u8, name: &str) -> Result<Packet, String> {
    require_user_slot(slot)?;
    let name = normalize_name(name)?;
    let mut bytes = vec![0xaa, 0x0a, 0, 0, 0x30, 1 + name.len() as u8, slot];
    bytes.extend_from_slice(name.as_bytes());
    bytes.extend_from_slice(&[0, END]);
    Ok(Packet::new(REPORT_ID, bytes))
}

pub fn parse_name(data: &[u8], slot: u8) -> Result<String, String> {
    require_user_slot(slot)?;
    let bytes = payload(data, 0x30).ok_or("Invalid Melody name response")?;
    if bytes.len() != 9 || bytes[0] != slot {
        return Err("Invalid Melody name slot or length".into());
    }
    let field = &bytes[1..];
    let end = field.iter().position(|&b| b == 0).unwrap_or(field.len());
    if !field[..end].iter().all(|b| b.is_ascii_alphanumeric()) {
        return Err("Invalid Melody name characters".into());
    }
    String::from_utf8(field[..end].to_vec()).map_err(|e| e.to_string())
}

pub fn preset_request() -> Packet {
    read(PRESET)
}

pub fn preset_write(preset: u8) -> Result<Packet, String> {
    if !PRESETS.contains(&preset) {
        return Err(format!("Unknown Melody preset: {preset}"));
    }
    Ok(Packet::new(
        REPORT_ID,
        vec![0xAA, 0x0A, 0, 0, PRESET, 1, preset, 0, END],
    ))
}

/// Bytes 2..4 carry a firmware-owned 16-bit counter. Match the actual header,
/// command, declared payload length and trailer, never either counter byte.
fn payload(data: &[u8], command: u8) -> Option<&[u8]> {
    if data.len() < 8 || data[..2] != [0xBB, 0x0B] || data[4] != command {
        return None;
    }
    let end = 6 + data[5] as usize;
    // Live name replies (sakana2/sakana3) carry one extra byte after the
    // declared slot + 8-byte field, then CRC and END. That byte is stale
    // buffer content (00 in one capture, EE in another), so it is skipped and
    // never interpreted. Only this exact shape is accepted; arbitrary stale
    // tails are not searched for END.
    let padded_name = command == 0x30 && data[5] == 9 && data.get(end + 2) == Some(&END);
    (data.get(end + 1) == Some(&END) || padded_name).then(|| &data[6..end])
}

pub fn parse_preset(data: &[u8]) -> Result<u8, String> {
    match payload(data, PRESET) {
        Some(&[preset]) if PRESETS.contains(&preset) => Ok(preset),
        _ => Err("Invalid Melody preset response".into()),
    }
}

pub fn firmware_request() -> Packet {
    read(FIRMWARE)
}

pub fn parse_firmware(data: &[u8]) -> Result<String, String> {
    // The live Melody returns just the header and three version bytes, with
    // no reliable CRC/END: the rest of its HID buffer can retain old EQ bytes.
    // Keep normal framed replies, but allow this captured three-byte form
    // only for the read-only firmware command, not EQ or bank verification.
    let version = payload(data, FIRMWARE).or_else(|| {
        (data.len() >= 9 && data[..2] == [0xbb, 0x0b] && data[4..6] == [FIRMWARE, 3])
            .then(|| &data[6..9])
    });
    match version {
        Some(version) if !version.is_empty() => Ok(version
            .iter()
            .map(u8::to_string)
            .collect::<Vec<_>>()
            .join(".")),
        _ => Err("Invalid Melody firmware response".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sakana2_control_replies_decode_without_losing_layout_checks() {
        use super::super::{sakana2, sakana3};
        assert_eq!(parse_preset(sakana2::PRESET), Ok(160));
        assert_eq!(parse_name(sakana2::NAME, 160), Ok("FD15".into()));
        for data in [sakana2::FIRMWARE_STALE, sakana2::FIRMWARE_SHORT] {
            assert_eq!(parse_firmware(data), Ok("1.2.0".into()));
        }
        for end in 0..18 {
            assert!(parse_name(&sakana2::NAME[..end], 160).is_err(), "{end}");
        }
        // The byte after the declared field is stale: 00 and EE both occur.
        for stale in [0x00, 0xee, 0x01] {
            let mut data = sakana2::NAME.to_vec();
            data[15] = stale;
            assert_eq!(parse_name(&data, 160), Ok("FD15".into()), "{stale:#x}");
        }
        assert_eq!(parse_name(sakana3::NAME_STALE_END, 160), Ok("FD15".into()));
        let mut invalid = sakana2::NAME.to_vec();
        invalid[17] = 0; // END is still required.
        assert!(parse_name(&invalid, 160).is_err());
        assert!(parse_name(sakana2::NAME, 161).is_err());
        for end in 0..9 {
            assert!(parse_firmware(&sakana2::FIRMWARE_SHORT[..end]).is_err());
        }
        for offset in [0, 1, 4, 5] {
            let mut invalid = sakana2::FIRMWARE_SHORT.to_vec();
            invalid[offset] = 0xff;
            assert!(parse_firmware(&invalid).is_err(), "{offset}");
        }
    }

    #[test]
    fn names_use_slot_ids_and_bounded_ascii_fields() {
        assert_eq!(
            name_request(162).unwrap().framed(),
            [7, 0xbb, 0x0b, 0, 0, 0x30, 1, 162, 0, 0xee]
        );
        assert_eq!(name_write(160, "abc12345").unwrap().payload[5], 9);
        assert!(name_write(159, "ABC").is_err());
        assert!(name_write(160, "123456789").is_err());
        let valid = [
            0xbb, 0x0b, 0, 12, 0x30, 9, 162, b'A', b'B', b'C', 0, 0, 0, 0, 0, 0x77, 0xee, 0x98,
        ];
        assert_eq!(parse_name(&valid, 162).unwrap(), "ABC");
        assert!(parse_name(&valid, 161).is_err());
        for end in 0..17 {
            assert!(parse_name(&valid[..end], 162).is_err());
        }
        let mut invalid = valid;
        invalid[7] = 0xff;
        assert!(parse_name(&invalid, 162).is_err());
    }

    #[test]
    fn frames_match_the_web_app_with_zero_check_bytes() {
        assert_eq!(
            preset_request().framed(),
            [7, 0xBB, 0x0B, 0, 0, 0x16, 0, 0, 0xEE]
        );
        assert_eq!(
            firmware_request().framed(),
            [7, 0xBB, 0x0B, 0, 0, 0x0B, 0, 0, 0xEE]
        );
        // Same shape as the preset select Glacier already sends before EQ writes.
        assert_eq!(
            preset_write(160).unwrap().framed(),
            [7, 0xAA, 0x0A, 0, 0, 0x16, 1, 160, 0, 0xEE]
        );
        assert!(preset_write(7).is_err());
        assert!(preset_write(241).is_err());
    }

    #[test]
    fn parses_replies_with_firmware_owned_counter_and_check_byte() {
        for preset in PRESETS {
            let reply = [0xBB, 0x0B, 0, 0x42, 0x16, 1, preset, 0x99, 0xEE, 0x65, 0xEE];
            assert_eq!(parse_preset(&reply), Ok(preset));
        }
        assert!(parse_preset(&[0xBB, 0x0B, 0, 1, 0x16, 1, 9, 0, 0xEE]).is_err());
        assert!(parse_preset(&[0xBB, 0x0B, 0, 1, 0x17, 1, 0, 0, 0xEE]).is_err());
        assert!(parse_preset(&[0xAA, 0x0A, 0, 1, 0x16, 1, 0, 0, 0xEE]).is_err());
        assert!(parse_preset(&[0xBB, 0x0B, 0, 1, 0x16, 1, 0, 0, 0]).is_err());
        assert!(parse_preset(&[0xBB, 0x0B, 0, 1, 0x16, 1, 0]).is_err());
        let version = [0xBB, 0x0B, 0, 3, 0x0B, 3, 1, 2, 7, 0x10, 0xEE];
        assert_eq!(parse_firmware(&version).unwrap(), "1.2.7");
        assert!(parse_firmware(&[0xBB, 0x0B, 0, 3, 0x0B, 0, 0, 0xEE]).is_err());
        assert!(parse_firmware(&[0xBB, 0x0B, 0, 3, 0x0B, 4, 1, 2, 0x10, 0xEE]).is_err());
    }
}
