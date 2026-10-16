// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Original Dawn Pro controls, separate from Dawn Pro 2 PEQ.
//! Adapted from Abdul Mateen (RetR0-hex), who reports Windows 10 hardware
//! verification with the original 2FC6:F06A and the standard Windows drivers:
//! https://github.com/RetR0-hex/moondrop-dawn-pro-gui/blob/69f95f669377646da1e9ba931bec9a5dc9b5d40c/moondrop/device.py
//! https://github.com/RetR0-hex/moondrop-dawn-pro-gui/blob/69f95f669377646da1e9ba931bec9a5dc9b5d40c/moondrop/protocol.py
//! Cross-checks for C0 A5 command values (USB-vendor transports, not HID PEQ):
//! https://github.com/frahz/mdrop/blob/98d4e36e70aea3a3fb3b390c1523ade1e3da9bc0/mdrop/src/lib.rs
//! https://github.com/unins0/mddctl/blob/4a96c244e59bf00e6d8ad4feea2f564ffe295237/utils.cpp
//! These implement volume, gain, reconstruction filter and LED, not hardware
//! parametric EQ. Upstream verification is not Glacier EQ hardware testing.

/* Upstream permission notice for the adapted protocol implementation:
MIT License

Copyright (c) 2026 Abdul Mateen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

This project is not affiliated with or endorsed by MOONDROP. "MOONDROP" and
"Dawn Pro" are trademarks of their respective owner.

*/

use crate::device::protocol::Protocol;

/// No hardware EQ: the original Dawn Pro has sound controls only.
pub static PROTOCOL: Protocol = Protocol {
    id: "Moondrop Dawn Pro",
    eq: None,
};

pub const VENDOR_ID: u16 = 0x2FC6;
pub const PRODUCT_ID: u16 = 0xF06A;
pub const OUTPUT_LEN: usize = 8;
pub const INPUT_LEN: usize = 9;
const STATUS: u8 = 0xA3;
const VOLUME: u8 = 0xA2;
const VOLUME_CODES: [u8; 61] = [
    255, 200, 180, 170, 160, 150, 140, 130, 122, 116, 110, 106, 102, 98, 94, 90, 88, 86, 84, 82,
    80, 78, 76, 74, 72, 70, 68, 66, 64, 62, 60, 58, 56, 54, 52, 50, 48, 46, 44, 42, 40, 38, 36, 34,
    32, 30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2, 0,
];

pub trait DawnProIo {
    fn write(&mut self, report: &[u8; OUTPUT_LEN]) -> Result<(), String>;
    /// The report ID is byte zero; Windows requires exactly nine bytes.
    fn get_input_report(&mut self, report: &mut [u8; INPUT_LEN]) -> Result<usize, String>;
    fn sleep_ms(&mut self, ms: u64) {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Settings {
    pub filter: u8,
    pub high_gain: bool,
    pub led: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Volume {
    pub raw: u8,
    pub step: u8,
}

pub struct DawnPro<'a> {
    io: &'a mut dyn DawnProIo,
}

impl<'a> DawnPro<'a> {
    pub fn new(io: &'a mut dyn DawnProIo) -> Self {
        Self { io }
    }

    fn send(&mut self, command: u8, value: u8) -> Result<(), String> {
        self.io.write(&[0, 0xC0, 0xA5, command, value, 0, 0, 0])?;
        self.io.sleep_ms(100);
        Ok(())
    }

    fn query(&mut self, command: u8) -> Result<[u8; INPUT_LEN], String> {
        let mut reply = [0; INPUT_LEN];
        // The device holds its latest reply, not a queue. Alternate requests
        // and reads to allow a preceding command's response to settle.
        for attempt in 0..6 {
            if attempt % 2 == 0 {
                self.send(command, 0)?;
            } else {
                self.io.sleep_ms(100);
            }
            reply.fill(0);
            let length = self.io.get_input_report(&mut reply)?;
            if length != INPUT_LEN {
                return Err(format!(
                    "Short Dawn Pro input report: expected {INPUT_LEN}, got {length}"
                ));
            }
            if reply[..4] == [0, 0xA0, 0xA5, command] {
                return Ok(reply);
            }
        }
        Err(format!(
            "Dawn Pro reply did not match command 0x{command:02X}: {reply:02X?}"
        ))
    }

    pub fn settings(&mut self) -> Result<Settings, String> {
        let reply = self.query(STATUS)?;
        if reply[4] > 4 || reply[5] > 1 || reply[6] > 2 {
            return Err(format!("Unknown Dawn Pro settings: {reply:02X?}"));
        }
        Ok(Settings {
            filter: reply[4],
            high_gain: reply[5] == 1,
            led: reply[6],
        })
    }

    pub fn volume(&mut self) -> Result<Volume, String> {
        let raw = self.query(VOLUME)?[5];
        let step = VOLUME_CODES
            .iter()
            .enumerate()
            .min_by_key(|(_, code)| code.abs_diff(raw))
            .map(|(index, _)| index as u8)
            .expect("volume table is nonempty");
        Ok(Volume { raw, step })
    }

    pub fn set_filter(&mut self, value: u8) -> Result<(), String> {
        if value > 4 {
            return Err("Dawn Pro filter must be 0..4".into());
        }
        self.send(0x01, value)?;
        let actual = self.settings()?.filter;
        verify("filter", value, actual)
    }

    pub fn set_gain(&mut self, high: bool) -> Result<(), String> {
        self.send(0x02, u8::from(high))?;
        // Gain changes rescale the analog output. Re-latch the current volume,
        // as the hardware-verified reference does, without changing its value.
        self.send(VOLUME, 0)?;
        let actual = u8::from(self.settings()?.high_gain);
        verify("gain", u8::from(high), actual)
    }

    pub fn set_led(&mut self, value: u8) -> Result<(), String> {
        if value > 2 {
            return Err("Dawn Pro LED mode must be 0..2".into());
        }
        self.send(0x06, value)?;
        let actual = self.settings()?.led;
        verify("LED", value, actual)
    }

    pub fn set_volume(&mut self, step: u8) -> Result<(), String> {
        let value = *VOLUME_CODES
            .get(usize::from(step))
            .ok_or("Dawn Pro volume step must be 0..60")?;
        self.send(0x04, value)?;
        let actual = self.volume()?.raw;
        verify("volume attenuation", value, actual)
    }
}

fn verify(label: &str, expected: u8, actual: u8) -> Result<(), String> {
    if expected != actual {
        return Err(format!(
            "Dawn Pro did not apply {label}: wrote {expected}, read back {actual}"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    #[derive(Default)]
    struct FakeIo {
        writes: Vec<[u8; OUTPUT_LEN]>,
        reads: VecDeque<([u8; INPUT_LEN], usize)>,
        sleeps: Vec<u64>,
    }
    impl DawnProIo for FakeIo {
        fn write(&mut self, report: &[u8; OUTPUT_LEN]) -> Result<(), String> {
            self.writes.push(*report);
            Ok(())
        }
        fn get_input_report(&mut self, report: &mut [u8; INPUT_LEN]) -> Result<usize, String> {
            let (reply, length) = self.reads.pop_front().ok_or("missing test reply")?;
            *report = reply;
            Ok(length)
        }
        fn sleep_ms(&mut self, ms: u64) {
            self.sleeps.push(ms);
        }
    }
    fn status(filter: u8, gain: u8, led: u8) -> [u8; INPUT_LEN] {
        [0, 0xA0, 0xA5, STATUS, filter, gain, led, 0, 0]
    }
    fn volume(raw: u8) -> [u8; INPUT_LEN] {
        [0, 0xA0, 0xA5, VOLUME, 0, raw, 0, 0, 0]
    }
    #[test]
    fn reads_unnumbered_eight_byte_commands_and_nine_byte_replies() {
        let mut io = FakeIo::default();
        io.reads.extend([(status(3, 1, 2), 9), (volume(30), 9)]);
        let mut device = DawnPro::new(&mut io);
        assert_eq!(
            device.settings().unwrap(),
            Settings {
                filter: 3,
                high_gain: true,
                led: 2
            }
        );
        assert_eq!(device.volume().unwrap(), Volume { raw: 30, step: 45 });
        assert_eq!(
            io.writes,
            [
                [0, 0xC0, 0xA5, STATUS, 0, 0, 0, 0],
                [0, 0xC0, 0xA5, VOLUME, 0, 0, 0, 0]
            ]
        );
        assert_eq!(io.sleeps, [100, 100]);
    }
    #[test]
    fn stale_command_is_not_used_as_settings() {
        let mut io = FakeIo::default();
        io.reads.extend([(volume(30), 9), (status(2, 0, 1), 9)]);
        assert_eq!(DawnPro::new(&mut io).settings().unwrap().filter, 2);
        assert_eq!(io.writes.len(), 1);
        assert_eq!(io.sleeps, [100, 100]);
    }
    #[test]
    fn mismatches_are_bounded_and_short_or_invalid_replies_fail() {
        let mut io = FakeIo::default();
        io.reads.extend([(volume(30), 9); 6]);
        assert!(DawnPro::new(&mut io).settings().is_err());
        assert_eq!(io.writes.len(), 3);
        io.reads.push_back((status(0, 0, 0), 8));
        assert!(DawnPro::new(&mut io)
            .settings()
            .unwrap_err()
            .contains("Short"));
        io.reads.push_back((status(5, 0, 0), 9));
        assert!(DawnPro::new(&mut io)
            .settings()
            .unwrap_err()
            .contains("Unknown"));
    }
    #[test]
    fn setters_verify_actual_values_and_gain_refreshes_volume() {
        let mut io = FakeIo::default();
        io.reads.extend([
            (status(4, 0, 0), 9),
            (status(4, 1, 0), 9),
            (status(4, 1, 2), 9),
            (volume(30), 9),
        ]);
        let mut device = DawnPro::new(&mut io);
        device.set_filter(4).unwrap();
        device.set_gain(true).unwrap();
        device.set_led(2).unwrap();
        device.set_volume(45).unwrap();
        assert_eq!(
            io.writes.iter().map(|report| report[3]).collect::<Vec<_>>(),
            [1, STATUS, 2, VOLUME, STATUS, 6, STATUS, 4, VOLUME]
        );
        assert_eq!(io.writes[7][4], 30);
    }
    #[test]
    fn bad_arguments_do_not_write_and_failed_verification_is_not_success() {
        let mut io = FakeIo::default();
        let mut device = DawnPro::new(&mut io);
        assert!(device.set_filter(5).is_err());
        assert!(device.set_led(3).is_err());
        assert!(device.set_volume(61).is_err());
        assert!(io.writes.is_empty());
        io.reads.push_back((status(0, 0, 0), 9));
        assert!(DawnPro::new(&mut io)
            .set_filter(4)
            .unwrap_err()
            .contains("did not apply"));
    }
    #[test]
    fn volume_direction_and_all_reference_steps_are_preserved() {
        for step in 0..=60u8 {
            let mut io = FakeIo::default();
            io.reads
                .push_back((volume(VOLUME_CODES[usize::from(step)]), 9));
            DawnPro::new(&mut io).set_volume(step).unwrap();
            assert_eq!(io.writes[0][4], VOLUME_CODES[usize::from(step)]);
        }
        assert_eq!(VOLUME_CODES[0], 255);
        assert_eq!(VOLUME_CODES[60], 0);
    }
}
