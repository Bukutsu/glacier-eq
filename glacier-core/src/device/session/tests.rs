// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use super::io::fake::{FakeIo, IoEvent};
use super::*;
use crate::device::families::walkplay::READ;
use crate::device::get_supported_device;

#[test]
fn original_dawn_pro_refuses_eq_without_touching_the_device() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x2FC6, 0xF06A).unwrap();
        let mut io = FakeIo::default();
        let mut session = DeviceSession::new(&mut io, profile);
        let peq = PEQData {
            filters: vec![],
            global_gain: 0.0,
        };
        for error in [
            session.pull().await.unwrap_err(),
            session.persistent_push(peq.clone()).await.unwrap_err(),
            session.unverified_push(peq.clone()).await.unwrap_err(),
            session.apply_ram(peq).await.unwrap_err(),
        ] {
            assert_eq!(error, "Moondrop Dawn Pro has no hardware EQ");
        }
        assert!(io.writes.is_empty());
        assert_eq!(io.read_calls, 0);
    });
}

#[test]
fn invalid_catalog_capabilities_fail_before_io_or_reset_allocation() {
    let base = get_supported_device(0x3302, 0x43e6).unwrap();
    let invalid: &[fn(&mut super::super::DeviceCapabilities)] = &[
        |caps| caps.num_bands = 0,
        |caps| caps.num_bands = 257,
        |caps| caps.num_bands = usize::MAX,
        |caps| caps.supported_filter_types = &[],
        |caps| caps.gain_tolerance = f64::NAN,
        |caps| caps.gain_tolerance = f64::INFINITY,
        |caps| caps.gain_tolerance = -0.1,
        |caps| caps.q_tolerance = f64::NAN,
        |caps| caps.q_tolerance = -0.1,
        |caps| caps.freq_tolerance = -1,
        |caps| caps.q_range = (2.0, 1.0),
        |caps| caps.dsp_sample_rate = f64::NAN,
    ];
    for mutate in invalid {
        let mut caps = base.caps.clone();
        mutate(&mut caps);
        // Session profiles are static in production; leak only this test fixture.
        let profile = Box::leak(Box::new(DeviceProfile {
            name: base.name,
            protocol: base.protocol,
            vendor_id: base.vendor_id,
            product_id: base.product_id,
            status: base.status,
            family: base.family,
            caps,
            controls: base.controls,
            spec: base.spec,
        }));
        let mut io = FakeIo::default();
        block_on(async {
            let mut session = DeviceSession::new(&mut io, profile);
            assert!(session.pull().await.unwrap_err().starts_with("Device"));
            assert!(session.reset_eq().await.unwrap_err().starts_with("Device"));
        });
        assert!(
            io.events.is_empty(),
            "invalid metadata must not touch the DAC"
        );
    }
}

#[test]
fn invalid_mutation_writes_nothing() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        let mut session = DeviceSession::new(&mut io, profile);
        let error = session
            .apply_ram(PEQData {
                filters: vec![],
                global_gain: f64::NAN,
            })
            .await
            .unwrap_err();
        assert!(error.contains("finite"));
        assert!(io.writes.is_empty());
    });
}

#[test]
fn apply_ram_restores_the_snapshot_when_apply_fails() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x2972, 0x0102).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]);
        io.reads
            .push_back(vec![0xBB, 0x0B, 0, 0, 0x17, 2, 0, 10, 0, 0xEE]);
        for index in 0..5u8 {
            io.reads.push_back(vec![
                0xBB, 0x0B, 0, 0, 0x15, 8, index, 0, 10, 0x03, 0xE8, 0, 100, 0, 0, 0xEE,
            ]);
        }
        // Requested write, rollback write, and verification pull each perform
        // their own init drain before the verification responses.
        io.reads.push_back(vec![]);
        io.reads.push_back(vec![]);
        io.reads.push_back(vec![]);
        io.reads
            .push_back(vec![0xBB, 0x0B, 0, 0, 0x17, 2, 0, 10, 0, 0xEE]);
        for index in 0..5u8 {
            io.reads.push_back(vec![
                0xBB, 0x0B, 0, 0, 0x15, 8, index, 0, 10, 0x03, 0xE8, 0, 100, 0, 0, 0xEE,
            ]);
        }
        // Initial pull uses writes 1..6. Fail all three attempts for the
        // requested filter at writes 9..11, then allow the rollback writes.
        io.failing_write_calls.extend([9, 10, 11]);
        let peq = PEQData {
            filters: (0..5).map(|index| Filter::enabled(index, false)).collect(),
            global_gain: -2.0,
        };

        let error = DeviceSession::new(&mut io, profile)
            .apply_ram(peq)
            .await
            .expect_err("a failed RAM apply must report the rollback result");
        assert!(error.contains("previous RAM state restored"), "{error}");
        assert!(io.write_calls >= 15, "rollback writes were not attempted");
    });
}

#[test]
fn walkplay_live_apply_writes_ram_without_reading_or_saving() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e6).unwrap();
        let mut io = FakeIo::default();
        let mut progress_calls = 0;
        let mut progress = |_: &str, _: f32| progress_calls += 1;
        let (applied, _) =
            DeviceSession::with_progress_and_nonce(&mut io, profile, &mut progress, 1)
                .live_apply(test_peq())
                .await
                .unwrap();
        assert_eq!(applied.filters.len(), 10);
        assert_eq!(
            progress_calls, 0,
            "live edits must not drive the progress bar"
        );

        let commands: Vec<[u8; 2]> = io.writes.iter().map(|w| [w[1], w[2]]).collect();
        // Version read to open the transaction, 10 bands, preamp, then temp apply.
        assert_eq!(commands.first(), Some(&[READ, 0x0C]));
        assert_eq!(commands.iter().filter(|c| c[1] == 0x09).count(), 10);
        assert_eq!(commands.last().map(|c| c[0]), Some(0x01));
        assert_eq!(io.writes.last().unwrap()[2], 0x0A, "ends with temp apply");
        assert!(
            io.writes.iter().all(|w| !(w[1] == 0x01 && w[2] == 0x01)),
            "a live apply must never send the flash save"
        );
        assert!(
            io.writes.iter().all(|w| w[1] != READ || w[2] == 0x0C),
            "a live apply reads nothing back but the version"
        );
    });
}

#[test]
fn confirmed_walkplay_devices_live_apply_without_saving() {
    let walkplay: Vec<_> = crate::device::SUPPORTED_DEVICES
        .iter()
        .filter(|device| device.protocol.id == "Walkplay")
        .collect();
    assert!(walkplay.len() > 1);
    for device in walkplay {
        // Vendor 262A (Fosi / iBasso) is not confirmed as the same protocol.
        assert_eq!(
            device.caps.supports_ram_apply,
            device.vendor_id != 0x262A,
            "{}",
            device.name
        );
        let packets = device.protocol.eq.unwrap().ram_apply_packets();
        assert_eq!(packets.len(), 1, "{}: temp apply only", device.name);
    }
}

#[test]
fn live_apply_refuses_a_device_without_ram_apply() {
    crate::device::session::block_on(async {
        // FiiO KA15: a hardware EQ without temporary apply.
        let profile = get_supported_device(0x2972, 0x0104).unwrap();
        let mut io = FakeIo::default();
        let error = DeviceSession::new(&mut io, profile)
            .live_apply(test_peq())
            .await
            .unwrap_err();
        assert!(error.contains("RAM apply"), "{error}");
        assert!(io.writes.is_empty());
    });
}

fn queue_pull(io: &mut FakeIo, gain: i8) {
    queue_pull_with_nonce_start(io, gain, 1);
}

fn queue_pull_with_nonce_start(io: &mut FakeIo, gain: i8, nonce_start: u8) {
    io.reads.push_back(vec![]); // init drain terminator
    io.reads.push_back(vec![
        READ,
        super::super::families::walkplay::CMD_GLOBAL_GAIN,
        0,
        0,
        gain as u8,
        0,
    ]);
    queue_bands(io, nonce_start);
}

fn queue_bands(io: &mut FakeIo, nonce_start: u8) {
    for index in 0..10u8 {
        let mut packet = vec![0; 34];
        packet[0] = READ;
        packet[1] = super::super::families::walkplay::CMD_PEQ_VALUES;
        packet[2] = nonce_start + index;
        packet[4] = index;
        packet[27..29].copy_from_slice(&(100 + index as u16).to_le_bytes());
        packet[29..31].copy_from_slice(&256u16.to_le_bytes());
        packet[31..33].copy_from_slice(&256i16.to_le_bytes());
        packet[33] = 2;
        io.reads.push_back(packet);
    }
}

/// One complete pull whose responses parse to a flat, zero-preamp state:
/// exactly the transient default that `pull`'s retry exists to confirm.
fn queue_default_pull(io: &mut FakeIo) {
    io.reads.push_back(vec![]); // init drain terminator
    io.reads.push_back(vec![
        READ,
        super::super::families::walkplay::CMD_GLOBAL_GAIN,
        0,
        0,
        0,
        0,
    ]);
    for index in 0..10u8 {
        let mut packet = vec![0; 34];
        packet[0] = READ;
        packet[1] = super::super::families::walkplay::CMD_PEQ_VALUES;
        packet[2] = index + 1;
        packet[4] = index;
        packet[27..29].copy_from_slice(&(100 + index as u16).to_le_bytes());
        packet[29..31].copy_from_slice(&256u16.to_le_bytes());
        // raw gain stays 0 → parsed gain 0.0 → flat bands → default state.
        packet[33] = 2;
        io.reads.push_back(packet);
    }
}

#[test]
fn pull_surfaces_retry_error_instead_of_uncorroborated_default() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_default_pull(&mut io);
        // First attempt returns the suspect default; the confirming retry
        // exhausts its read budget unanswered and must fail the pull rather
        // than hand back the uncorroborated default as device truth.
        let error = DeviceSession::new(&mut io, profile)
            .pull()
            .await
            .unwrap_err();
        assert!(!error.is_empty());
    });
}

#[test]
fn pull_rejects_a_default_after_an_unanswered_gain_request() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // first init drain
        io.read_error_until = Some((2, 4, "transient read".into()));
        queue_default_pull(&mut io);
        let error = DeviceSession::new(&mut io, profile)
            .pull()
            .await
            .unwrap_err();
        assert!(error.contains("uncorrelated"), "{error}");
    });
}

#[test]
fn a_filter_read_keeps_the_transport_error_that_started_the_failure() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        // Drain, gain, then band 1's reads. The very first band read hits a
        // USB error; every later attempt in every round simply times out, so
        // the last error the loop saw is the generic timeout.
        io.reads.push_back(vec![]); // init drain
        io.reads.push_back(vec![
            READ,
            super::super::families::walkplay::CMD_GLOBAL_GAIN,
            0,
            0,
            0,
            0,
        ]);
        // read_error_until counts io.read calls, and the drain + gain read
        // already consumed the first two.
        io.read_error_until = Some((3, 3, "USB stall: transfer failed".into()));

        let error = DeviceSession::new(&mut io, profile)
            .pull()
            .await
            .expect_err("a band read that never answers must fail the pull");

        // The user is told what actually went wrong on the wire, not just
        // that the band read timed out. The gain path has reported both for
        // every round since it gained combine_errors; the band path did not,
        // so a real transport error only survived if it happened to land on
        // the final attempt of the final round.
        assert!(
            error.contains("USB stall: transfer failed"),
            "the first transport error must survive: {error}"
        );
    });
}

#[test]
fn pull_clears_invalid_response_state_before_a_valid_retry() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]);
        io.reads.push_back(vec![
            READ,
            super::super::families::walkplay::CMD_GLOBAL_GAIN,
            0,
            0,
            0,
            0,
        ]);
        let mut invalid = vec![0u8; 34];
        invalid[0] = READ;
        invalid[1] = super::super::families::walkplay::CMD_PEQ_VALUES;
        invalid[2] = 1;
        invalid[4] = 0;
        invalid[29..31].copy_from_slice(&256u16.to_le_bytes());
        invalid[31..33].copy_from_slice(&256i16.to_le_bytes());
        invalid[33] = 2;
        io.reads.push_back(invalid);
        queue_pull_with_nonce_start(&mut io, -1, 2);
        let peq = DeviceSession::new(&mut io, profile).pull().await.unwrap();
        assert_eq!(peq.global_gain, -1.0);
    });
}

#[test]
fn pull_preserves_a_concrete_read_error_across_retry() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // init drain terminator
        io.read_errors.push_back(Some("device disconnected".into()));

        let error = DeviceSession::new(&mut io, profile)
            .pull()
            .await
            .unwrap_err();
        assert!(error.contains("device disconnected"), "{error}");
    });
}

fn queue_gain(io: &mut FakeIo, gain: i8) {
    io.reads.push_back(vec![
        READ,
        super::super::families::walkplay::CMD_GLOBAL_GAIN,
        0,
        0,
        gain as u8,
        0,
    ]);
}

/// A gain request the DAC drops: a silent round, then the resend's quarantine.
fn queue_dropped_gain_request(io: &mut FakeIo) {
    for _ in 0..5 {
        io.reads.push_back(vec![]);
    }
    io.reads.push_back(vec![]); // retry quarantine terminator
}

#[test]
fn pull_accepts_a_resent_gain_read_that_an_independent_read_confirms() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // init drain terminator
        queue_dropped_gain_request(&mut io);
        queue_gain(&mut io, -7); // answer to the resend
        queue_gain(&mut io, -7); // independent confirmation
        queue_bands(&mut io, 1);
        let peq = DeviceSession::new(&mut io, profile).pull().await.unwrap();
        assert_eq!(peq.global_gain, -7.0);
    });
}

#[test]
fn pull_rejects_a_resent_gain_read_that_the_confirmation_contradicts() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // init drain terminator
        queue_dropped_gain_request(&mut io);
        queue_gain(&mut io, -7);
        queue_gain(&mut io, -6); // the first answer may have been stale
        let error = DeviceSession::new(&mut io, profile)
            .pull()
            .await
            .unwrap_err();
        assert!(error.contains("uncorrelated"), "{error}");
    });
}

#[test]
fn pull_rejects_a_gain_confirmation_that_needs_another_resend() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // init drain terminator
        queue_dropped_gain_request(&mut io);
        queue_gain(&mut io, -7);
        queue_dropped_gain_request(&mut io); // the confirmation is dropped too
        queue_gain(&mut io, -7);
        let error = DeviceSession::new(&mut io, profile)
            .pull()
            .await
            .unwrap_err();
        assert!(error.contains("uncorrelated"), "{error}");
    });
}

#[test]
fn pull_rejects_late_moondrop_gain_after_complete_pull_retry() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x35d8, 0x011d).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // first init drain
        for _ in 0..GAIN_READ_ATTEMPTS {
            io.reads.push_back(vec![]); // unanswered first gain request
        }
        io.reads.push_back(vec![]); // retry init drain
        io.reads.push_back(vec![0x80, 0x23, 0, 26, 0]); // late +1.0 dB response
        for index in 0..10u8 {
            let mut response = vec![0u8; 63];
            response[0] = 0x80;
            response[1] = 0x09;
            response[4] = index;
            response[27..29].copy_from_slice(&1_000u16.to_le_bytes());
            response[29..31].copy_from_slice(&256u16.to_le_bytes());
            response[31..33].copy_from_slice(&256i16.to_le_bytes());
            response[33] = 2;
            io.reads.push_back(response);
        }

        let error = DeviceSession::new(&mut io, profile)
            .pull()
            .await
            .unwrap_err();
        assert!(error.contains("uncorrelated"), "{error}");
    });
}

#[test]
fn ja11_push_verifies_ram_then_saves_last() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x2972, 0x0102).unwrap();
        let mut io = FakeIo::default();
        let queue_ja11_pull = |io: &mut FakeIo| {
            io.reads.push_back(vec![]); // init drain
            io.reads
                .push_back(vec![0xBB, 0x0B, 0, 0, 0x17, 2, 0, 10, 0, 0xEE]);
            for index in 0..5u8 {
                io.reads.push_back(vec![
                    0xBB, 0x0B, 0, 0, 0x15, 8, index, 0, 10, 0x03, 0xE8, 0, 100, 0, 0, 0xEE,
                ]);
            }
        };
        queue_ja11_pull(&mut io); // snapshot
        io.reads.push_back(vec![]); // push init drain
        queue_ja11_pull(&mut io); // RAM verification
        let peq = PEQData {
            filters: (0..5)
                .map(|index| Filter {
                    index,
                    enabled: true,
                    freq: 1000,
                    gain: 1.0,
                    q: 1.0,
                    filter_type: crate::FilterType::Peak,
                })
                .collect(),
            global_gain: 1.0,
        };

        DeviceSession::new(&mut io, profile)
            .persistent_push(peq)
            .await
            .unwrap();

        // The DAC re-enumerates after the save: it must be the final I/O.
        let save = [2, 0xAA, 0x0A, 0, 0, 0x19, 1, 3, 0, 0xEE];
        assert_eq!(io.writes.last().unwrap().as_slice(), save);
        assert_eq!(io.writes.iter().filter(|w| w[5] == 0x19).count(), 1);
        let last_write = io
            .events
            .iter()
            .rposition(|event| matches!(event, IoEvent::Write(_)))
            .unwrap();
        assert!(!io.events[last_write..]
            .iter()
            .any(|event| matches!(event, IoEvent::Read)));
    });
}

#[test]
fn ja11_pull_requires_healthy_gain_and_fails_before_bands() {
    block_on(async {
        for pid in [0x0101, 0x0102] {
            let profile = get_supported_device(0x2972, pid).unwrap();
            let mut io = FakeIo::default();
            let error = DeviceSession::new(&mut io, profile)
                .pull()
                .await
                .unwrap_err();
            assert_eq!(error, DAC_UNRESPONSIVE_ERROR);
            assert_eq!(io.writes, [vec![2, 0xbb, 0x0b, 0, 0, 0x17, 0, 0, 0xee]]);
        }
    });
}

#[test]
fn pull_rejects_late_fiio_gain_after_complete_pull_retry() {
    crate::device::session::block_on(async {
        // KA15 also requires a healthy gain read.
        let profile = get_supported_device(0x2972, 0x0104).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]);
        for _ in 0..GAIN_READ_ATTEMPTS {
            io.reads.push_back(vec![]);
        }
        io.reads.push_back(vec![]);
        io.reads
            .push_back(vec![0xBB, 0x0B, 0, 0, 0x17, 2, 0, 10, 0, 0xEE]);
        for index in 0..10u8 {
            io.reads.push_back(vec![
                0xBB, 0x0B, 0, 0, 0x15, 8, index, 0, 10, 0x03, 0xE8, 0, 100, 0, 0, 0xEE,
            ]);
        }

        let error = DeviceSession::new(&mut io, profile)
            .pull()
            .await
            .unwrap_err();
        assert!(error.contains("uncorrelated"), "{error}");
    });
}

#[test]
fn pull_reads_gain_and_waits_before_first_band() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1);

        DeviceSession::new(&mut io, profile).pull().await.unwrap();

        let gain_request = io
            .events
            .iter()
            .position(|event| {
                *event == IoEvent::Write(super::super::families::walkplay::CMD_GLOBAL_GAIN)
            })
            .unwrap();
        let first_band_request = io
            .events
            .iter()
            .position(|event| {
                *event == IoEvent::Write(super::super::families::walkplay::CMD_PEQ_VALUES)
            })
            .unwrap();
        assert!(gain_request < first_band_request);
        assert!(
            io.events[gain_request + 1..first_band_request].contains(&IoEvent::Sleep(
                profile
                    .protocol
                    .eq
                    .unwrap()
                    .write_timing()
                    .post_gain_read_ms
            ))
        );
    });
}

#[test]
fn dropped_band_response_is_resent_and_pull_succeeds() {
    crate::device::session::block_on(async {
        use super::super::families::walkplay::CMD_PEQ_VALUES;
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // init drain terminator
        io.reads.push_back(vec![
            READ,
            super::super::families::walkplay::CMD_GLOBAL_GAIN,
            0,
            0,
            0xFF,
            0,
        ]);
        // The DAC drops the first band-0 request: a full round of attempts
        // goes unanswered, then the resent request (with a fresh nonce) is
        // answered.
        for _ in 0..5 {
            io.reads.push_back(vec![]);
        }
        for index in 0..10u8 {
            let mut packet = vec![0; 34];
            packet[0] = READ;
            packet[1] = CMD_PEQ_VALUES;
            packet[2] = index + 2;
            packet[4] = index;
            packet[27..29].copy_from_slice(&(100 + index as u16).to_le_bytes());
            packet[29..31].copy_from_slice(&256u16.to_le_bytes());
            packet[31..33].copy_from_slice(&256i16.to_le_bytes());
            packet[33] = 2;
            io.reads.push_back(packet);
        }

        let peq = DeviceSession::new(&mut io, profile).pull().await.unwrap();
        assert_eq!(peq.filters.len(), 10);
        let band_requests = io
            .events
            .iter()
            .filter(|event| **event == IoEvent::Write(CMD_PEQ_VALUES))
            .count();
        assert_eq!(band_requests, 11);
    });
}

#[test]
fn healthy_pull_sends_each_band_request_once() {
    crate::device::session::block_on(async {
        use super::super::families::walkplay::CMD_PEQ_VALUES;
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1);

        DeviceSession::new(&mut io, profile).pull().await.unwrap();

        let band_requests = io
            .events
            .iter()
            .filter(|event| **event == IoEvent::Write(CMD_PEQ_VALUES))
            .count();
        assert_eq!(band_requests, 10);
    });
}

#[test]
fn pull_rotates_filter_nonces_between_reads() {
    crate::device::session::block_on(async {
        use super::super::families::walkplay::CMD_PEQ_VALUES;
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1);
        queue_pull_with_nonce_start(&mut io, -1, 11);
        let mut session = DeviceSession::new(&mut io, profile);
        session.pull().await.unwrap();
        session.pull().await.unwrap();

        let nonces: Vec<u8> = io
            .writes
            .iter()
            .filter(|packet| packet.get(2) == Some(&CMD_PEQ_VALUES))
            .map(|packet| packet[3])
            .collect();
        assert_eq!(nonces, (1..=20).collect::<Vec<_>>());
    });
}

fn test_peq() -> PEQData {
    PEQData {
        filters: (0..10)
            .map(|index| Filter {
                index,
                enabled: true,
                freq: 100 + index as u16,
                gain: 1.0,
                q: 1.0,
                filter_type: crate::FilterType::Peak,
            })
            .collect(),
        global_gain: -1.0,
    }
}

#[test]
fn mid_write_failure_rolls_back_and_verifies_backup() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1); // snapshot
        io.reads.push_back(vec![]); // push init drain
        io.reads.push_back(vec![]); // rollback init drain
        queue_pull_with_nonce_start(&mut io, -1, 11); // rollback readback
        io.failing_write_calls = [15, 16, 17].into();

        let error = DeviceSession::new(&mut io, profile)
            .persistent_push(test_peq())
            .await
            .unwrap_err();

        assert!(error.contains("Push write failed"), "{error}");
        assert!(error.contains("simulated write failure"), "{error}");
        assert!(error.contains("previous state restored"), "{error}");
    });
}

#[test]
fn commit_failure_rolls_back_and_verifies_backup() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1); // snapshot
        io.reads.push_back(vec![]); // push init drain
        io.reads.push_back(vec![]); // rollback init drain
        queue_pull_with_nonce_start(&mut io, -1, 11); // rollback readback
        io.failing_write_calls = [25, 26, 27].into();

        let error = DeviceSession::new(&mut io, profile)
            .persistent_push(test_peq())
            .await
            .unwrap_err();

        assert!(error.contains("Push commit failed"), "{error}");
        assert!(error.contains("simulated write failure"), "{error}");
        assert!(error.contains("previous state restored"), "{error}");
    });
}

#[test]
fn a_dropped_write_is_rewritten_once_before_anything_is_rolled_back() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1); // snapshot
        io.reads.push_back(vec![]); // push init drain
        queue_pull_with_nonce_start(&mut io, -2, 11); // the preamp write was dropped
        io.reads.push_back(vec![]); // rewrite init drain
        queue_pull_with_nonce_start(&mut io, -1, 21); // the rewrite landed
        let (actual, _) = DeviceSession::new(&mut io, profile)
            .persistent_push(test_peq())
            .await
            .expect("one dropped report must not fail the write");
        assert_eq!(actual.global_gain, -1.0);
        // Written and committed twice, never rolled back (a rollback would be a third).
        assert_eq!(
            io.writes
                .iter()
                .filter(|packet| packet.get(2)
                    == Some(&super::super::families::walkplay::CMD_TEMP_WRITE))
                .count(),
            2
        );
    });
}

#[test]
fn verification_mismatch_rolls_back_after_the_rewrite_also_fails() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1); // snapshot
        io.reads.push_back(vec![]); // push init drain
        queue_pull_with_nonce_start(&mut io, -2, 11); // mismatching readback
        io.reads.push_back(vec![]); // rewrite init drain
        queue_pull_with_nonce_start(&mut io, -2, 21); // still mismatching
        io.reads.push_back(vec![]); // rollback init drain
        queue_pull_with_nonce_start(&mut io, -1, 31); // rollback readback
        let error = DeviceSession::new(&mut io, profile)
            .persistent_push(test_peq())
            .await
            .unwrap_err();
        assert!(error.contains("previous state restored"), "{error}");
        assert_eq!(
            io.writes
                .iter()
                .filter(|packet| packet.get(2)
                    == Some(&super::super::families::walkplay::CMD_TEMP_WRITE))
                .count(),
            3
        );
    });
}

#[test]
fn persistent_push_refuses_an_invalid_rollback_snapshot() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // init drain terminator
        io.reads.push_back(vec![
            READ,
            super::super::families::walkplay::CMD_GLOBAL_GAIN,
            0,
            0,
            0xFF,
            0,
        ]);
        for index in 0..10u8 {
            let mut packet = vec![0; 34];
            packet[0] = READ;
            packet[1] = super::super::families::walkplay::CMD_PEQ_VALUES;
            packet[2] = index + 1;
            packet[4] = index;
            if index == 0 {
                packet[27..29].copy_from_slice(&0u16.to_le_bytes());
            } else {
                packet[27..29].copy_from_slice(&(100 + index as u16).to_le_bytes());
            }
            packet[29..31].copy_from_slice(&256u16.to_le_bytes());
            packet[31..33].copy_from_slice(&256i16.to_le_bytes());
            packet[33] = 2;
            io.reads.push_back(packet);
        }

        let error = DeviceSession::new(&mut io, profile)
            .persistent_push(test_peq())
            .await
            .unwrap_err();
        assert!(error.contains("invalid EQ response"), "{error}");
        assert_eq!(
            io.writes
                .iter()
                .filter(|packet| packet.get(2)
                    == Some(&super::super::families::walkplay::CMD_PEQ_VALUES))
                .count(),
            1
        );
        assert!(io
            .writes
            .iter()
            .filter(
                |packet| packet.get(2) == Some(&super::super::families::walkplay::CMD_PEQ_VALUES)
            )
            .all(|packet| packet.get(1) == Some(&READ)));
    });
}

#[test]
fn persistent_push_returns_the_verified_quantized_state() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1); // snapshot
        io.reads.push_back(vec![]); // push init drain
        queue_pull_with_nonce_start(&mut io, -1, 11); // verification readback

        let mut requested = test_peq();
        for filter in &mut requested.filters {
            filter.gain = 1.004;
        }
        let (committed, _warnings) = DeviceSession::new(&mut io, profile)
            .persistent_push(requested)
            .await
            .unwrap();

        assert_eq!(committed.filters[0].gain, 1.0);
        assert!(committed.filters.iter().all(|filter| filter.gain == 1.0));
    });
}

#[test]
fn push_surfaces_capability_clamp_warnings_instead_of_discarding_them() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, 0);

        // 99 dB is far outside this profile's preamp range; the clamp must
        // both rewrite the value AND report it. The old push path discarded
        // the warnings at normalization, so "Saved EQ to DAC" hid a silent
        // change to the user's EQ.
        let (committed, warnings) = DeviceSession::new(&mut io, profile)
            .unverified_push(PEQData {
                filters: vec![],
                global_gain: 99.0,
            })
            .await
            .unwrap();

        assert_eq!(committed.global_gain, 6.0, "value must be clamped");
        assert!(
            warnings.iter().any(|warning| warning.contains("preamp")),
            "clamp must be reported to the caller, got {warnings:?}"
        );
    });
}

#[test]
fn an_unverified_push_says_the_returned_state_was_not_read_back() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, 0);

        // The caller publishes this PEQ as the device's committed state and
        // clears the editor's dirty flag against it. With no readback there is
        // nothing behind it, so the result must say so rather than let a DAC
        // that silently dropped the write read as a confirmed commit.
        let (_, warnings) = DeviceSession::new(&mut io, profile)
            .unverified_push(PEQData {
                filters: vec![],
                global_gain: 0.0,
            })
            .await
            .unwrap();
        assert!(
            warnings.iter().any(|w| w == UNVERIFIED_PUSH_WARNING),
            "the unverified push must carry its caveat, got {warnings:?}"
        );
    });
}

#[test]
fn a_verified_push_carries_no_unverified_caveat() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_pull(&mut io, -1); // snapshot
        io.reads.push_back(vec![]); // push init drain
        queue_pull_with_nonce_start(&mut io, -1, 11); // verification readback

        let (_, warnings) = DeviceSession::new(&mut io, profile)
            .persistent_push(test_peq())
            .await
            .unwrap();
        // This path really did read the device back, so its PEQ is the
        // committed state and must stay unqualified — the caveat would
        // train the user to ignore it on the path where it matters.
        assert!(
            !warnings.iter().any(|w| w == UNVERIFIED_PUSH_WARNING),
            "a verified push must not claim it was unverified, got {warnings:?}"
        );
    });
}
