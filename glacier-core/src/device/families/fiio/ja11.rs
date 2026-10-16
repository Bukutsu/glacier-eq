// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! JA11 state controls, deliberately separate from PEQ and its save command.
//! Protocol evidence (not copied implementation):
//! https://github.com/Cyfine/ja11-web-control/tree/4d4eb83df6fcdf9e20b52e1bdf59a77f463b2c30
//! Credit: Cyfine's protocol.js requestValuePacket/setDeviceVolumePacket/
//! parseInputReport establish command 0x02, a one-byte 0..60 output level,
//! and payload byte 6 (report ID excluded). This is not PEQ preamp or dB.
//! PROTOCOL.md "Live verification" reports volume 60 -> 59 -> 60 readback
//! on firmware 2.20. Our stricter frame/range checks and fresh pre-read are
//! local safety measures; power-cycle persistence is not claimed.
//! PROTOCOL.md, protocol.js and app.js: volume 0..60; mic/UAC 0/1;
//! mic was observed restarting firmware 2.20; mic/UAC can alter USB interfaces.
//! That does not establish a restart on every write. We attempt live readback.
//! Compared with (PEQ-only Ircama; conflicting UAC enum in ParkWardRR):
//! https://github.com/Ircama/ja11-config/tree/affddff6c9808c33ce8b35b0b9759ff0d7f6e405
//! https://github.com/ParkWardRR/fiio-ja11-jcally-jm12-moondropkt02-kt02h20-dac-amp-control/tree/c59b923dc46a4666af2e7ae4b898256c5d92a293
//! These state writes do not use 0x19 PEQ save. Persistence across power loss
//! is not established; never auto-save or replay settings on connect.

use crate::device::Packet;

pub fn command(control: &str) -> Result<(u8, u8), String> {
    match control {
        "volume" => Ok((0x02, 60)),
        "microphone" => Ok((0x12, 1)),
        "uac" => Ok((0x20, 1)),
        _ => Err(format!("Unknown JA11 control: {control}")),
    }
}

pub fn request(control: &str) -> Result<Packet, String> {
    let (cmd, _) = command(control)?;
    Ok(Packet::new(2, vec![0xbb, 0x0b, 0, 0, cmd, 0, 0, 0xee]))
}

pub fn write(control: &str, value: u8) -> Result<Packet, String> {
    let (cmd, max) = command(control)?;
    if value > max {
        return Err(format!("JA11 {control} must be 0..{max}"));
    }
    Ok(Packet::new(
        2,
        vec![0xaa, 0x0a, 0, 0, cmd, 1, value, 0, 0xee],
    ))
}

pub fn parse(control: &str, data: &[u8]) -> Result<u8, String> {
    let (cmd, max) = command(control)?;
    // Reports may have trailing HID padding. Sequence and check bytes are
    // firmware-owned, not fixed zeros. Length locates the terminator.
    if data.len() < 9
        || data[..2] != [0xbb, 0x0b]
        || data[4] != cmd
        || data[5] != 1
        || data[8] != 0xee
        || data[6] > max
    {
        return Err(format!("Invalid JA11 {control} response"));
    }
    Ok(data[6])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn protocol_fixtures_and_ranges() {
        for (name, cmd, max) in [("volume", 2, 60), ("microphone", 18, 1), ("uac", 32, 1)] {
            assert_eq!(
                request(name).unwrap().framed(),
                vec![2, 0xbb, 0x0b, 0, 0, cmd, 0, 0, 0xee]
            );
            assert_eq!(
                write(name, max).unwrap().framed(),
                vec![2, 0xaa, 0x0a, 0, 0, cmd, 1, max, 0, 0xee]
            );
            assert!(write(name, max + 1).is_err());
            let reply = [0xbb, 0x0b, 1, 2, cmd, 1, max, 0x51, 0xee];
            assert_eq!(parse(name, &reply).unwrap(), max);
            for index in [0, 1, 4, 5, 6, 8] {
                let mut bad = reply;
                bad[index] = 255;
                assert!(parse(name, &bad).is_err());
            }
            for len in 0..9 {
                assert!(parse(name, &reply[..len]).is_err());
            }
        }
        assert!(request("peq").is_err());
    }
}
