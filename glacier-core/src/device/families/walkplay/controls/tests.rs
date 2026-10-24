// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use crate::device::get_supported_device;
use crate::device::session::fake::FakeIo;

/// The wire writes that set a register: [report id, WRITE, register, ...].
fn register_writes(io: &FakeIo, register: u8) -> usize {
    io.writes
        .iter()
        .filter(|write| write.get(1) == Some(&WRITE) && write.get(2) == Some(&register))
        .count()
}

#[test]
fn a_failed_control_reset_restores_the_settings_that_already_landed() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        // The device is on a non-default filter mode, Class-H, high gain,
        // mic +4 dB, balanced.
        queue_utility_status(&mut io, 2, 0, 1, 4, 0, 0);
        // The snapshot's six register reads are writes 1..6. The reset then
        // writes the filter (7) and amp mode (8), so its gain write is call 9.
        // Fail every attempt of it — send() retries three times — so the
        // filter and amp modes have already changed when the reset gives up,
        // and let the rollback through.
        io.failing_write_calls.extend([9, 10, 11]);
        queue_utility_status(&mut io, 2, 0, 1, 4, 0, 0); // verified rollback

        let error = DeviceSession::new(&mut io, profile)
            .reset_controls()
            .await
            .expect_err("a half-applied reset must not report success");
        assert!(
            error.contains("previous settings restored"),
            "the error must name the rollback: {error}"
        );
        // The rollback wrote the original filter mode back (FAST-PC = 2) and
        // committed once. Nothing was committed before the failure.
        assert!(io
            .writes
            .iter()
            .any(|write| { write.get(2) == Some(&CMD_FILTER_MODE) && write.get(4) == Some(&2) }));
        assert_eq!(register_writes(&io, CMD_FLASH_EQ), 1);
    });
}

#[test]
fn a_successful_control_reset_does_not_roll_back() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_utility_status(&mut io, 2, 0, 1, 4, 0, 0);
        queue_utility_status(&mut io, 1, 1, 0, 0, 0, 0);

        let state = DeviceSession::new(&mut io, profile)
            .reset_controls()
            .await
            .expect("a clean reset must succeed");
        assert_eq!(state.filter_mode, "FAST-LL");
        assert!(state.amp_mode_class_ab);
        assert!(!state.high_gain_mode);
        assert_eq!(state.mic_volume_db, 0);
    });
}

#[test]
fn a_control_reset_commits_once_and_waits_for_the_flash_before_reading() {
    crate::device::session::block_on(async {
        use crate::device::session::fake::IoEvent;
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_utility_status(&mut io, 2, 0, 1, 4, 0, 0);
        queue_utility_status(&mut io, 1, 1, 0, 0, 0, 0);

        DeviceSession::new(&mut io, profile)
            .reset_controls()
            .await
            .unwrap();

        // The DAC drops writes sent within 50 ms of a flash commit and
        // answers no read for about 200 ms, so a commit between registers
        // (or an immediate status read) silently loses the reset.
        assert_eq!(register_writes(&io, CMD_FLASH_EQ), 1);
        let flash = io
            .events
            .iter()
            .position(|event| *event == IoEvent::Write(CMD_FLASH_EQ))
            .unwrap();
        assert_eq!(io.events[flash + 1], IoEvent::Sleep(FLASH_SETTLE_MS));
        // The commit is the last register write; only reads follow it.
        let last_write = io
            .writes
            .iter()
            .rposition(|write| write.get(1) == Some(&WRITE))
            .unwrap();
        assert_eq!(io.writes[last_write].get(2), Some(&CMD_FLASH_EQ));
        // Register writes are one HID interval apart.
        assert!(io.events.contains(&IoEvent::Sleep(HID_INTERVAL_MS)));
    });
}

#[test]
fn a_silently_dropped_reset_write_is_detected_and_previous_settings_verified() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_utility_status(&mut io, 2, 0, 1, 4, 0, 0);
        // The reset gain write was lost even though the transport accepted it.
        queue_utility_status(&mut io, 1, 1, 1, 0, 0, 0);
        queue_utility_status(&mut io, 2, 0, 1, 4, 0, 0);
        let error = DeviceSession::new(&mut io, profile)
            .reset_controls()
            .await
            .unwrap_err();
        assert!(error.contains("Control verification failed"), "{error}");
        assert!(error.contains("previous settings restored"), "{error}");
        assert_eq!(register_writes(&io, CMD_FLASH_EQ), 2);
    });
}

#[test]
fn a_silently_dropped_rollback_write_is_not_reported_as_restored() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_utility_status(&mut io, 2, 0, 1, 4, 0, 0);
        queue_utility_status(&mut io, 1, 1, 1, 0, 0, 0);
        // The original filter mode did not return during rollback.
        queue_utility_status(&mut io, 1, 0, 1, 4, 0, 0);
        let error = DeviceSession::new(&mut io, profile)
            .reset_controls()
            .await
            .unwrap_err();
        assert!(
            error.contains("restoring the previous settings failed"),
            "{error}"
        );
        assert!(!error.contains("previous settings restored"), "{error}");
    });
}

#[test]
fn reset_verification_checks_every_control_field() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        for (filter, amp, gain, mic, left, right) in [
            (2, 1, 0, 0, 0, 0),
            (1, 0, 0, 0, 0, 0),
            (1, 1, 1, 0, 0, 0),
            (1, 1, 0, 4, 0, 0),
            (1, 1, 0, 0, 255, 0),
            (1, 1, 0, 0, 0, 255),
        ] {
            let mut io = FakeIo::default();
            queue_utility_status(&mut io, 2, 0, 1, 4, 0, 0);
            queue_utility_status(&mut io, filter, amp, gain, mic, left, right);
            queue_utility_status(&mut io, 2, 0, 1, 4, 0, 0);
            let error = DeviceSession::new(&mut io, profile)
                .reset_controls()
                .await
                .unwrap_err();
            assert!(error.contains("Control verification failed"), "{error}");
        }
    });
}

#[test]
fn factory_reset_verifies_its_final_control_writes() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        for gain_mode in [0, 1] {
            let mut io = FakeIo::default();
            queue_reset_eq_read(&mut io, -1, 1); // snapshot
            io.reads.push_back(vec![]); // write init drain
            queue_reset_eq_read(&mut io, 0, 11); // verify flat EQ
            queue_reset_eq_read(&mut io, 0, 21); // corroborate default state
            queue_utility_status(&mut io, 1, 1, gain_mode, 0, 0, 0);
            let result = DeviceSession::new(&mut io, profile).factory_reset().await;
            if gain_mode == 0 {
                result.expect("matching controls complete the reset");
            } else {
                let error = result.expect_err("a dropped gain write must fail factory reset");
                assert!(error.contains("Control verification failed"), "{error}");
            }
        }
    });
}

fn queue_reset_eq_read(io: &mut FakeIo, gain: i8, nonce_start: u8) {
    use crate::device::families::walkplay as wp;
    io.reads.push_back(vec![]);
    io.reads
        .push_back(vec![READ, wp::CMD_GLOBAL_GAIN, 0, 0, gain as u8, 0]);
    for index in 0..10 {
        let filter = crate::eq::Filter::enabled(index, false);
        let mut packet = vec![0; 34];
        packet[0] = READ;
        packet[1] = wp::CMD_PEQ_VALUES;
        packet[2] = nonce_start + index;
        packet[4] = index;
        packet[27..29].copy_from_slice(&filter.freq.to_le_bytes());
        packet[29..31].copy_from_slice(&((filter.q * 256.0).round() as u16).to_le_bytes());
        packet[33] = filter.filter_type.into();
        io.reads.push_back(packet);
    }
}

#[test]
fn a_utility_setter_confirms_readback_before_reporting_success() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_utility_status(&mut io, 1, 1, 0, 4, 0, 0);
        // The filter change lands. Unrelated mic readback can drift by one dB
        // on this family, so it must not turn a verified filter write into a
        // false failure.
        queue_utility_status(&mut io, 2, 1, 0, 5, 0, 0);

        let actual = DeviceSession::new(&mut io, profile)
            .set_filter_mode("FAST-PC")
            .await
            .expect("the readback confirms the requested filter");

        assert_eq!(actual.filter_mode, "FAST-PC");
        assert_eq!(actual.mic_volume_db, 5);
        assert_eq!(register_writes(&io, CMD_FILTER_MODE), 1);
        assert_eq!(register_writes(&io, CMD_FLASH_EQ), 1);
    });
}

#[test]
fn a_silently_dropped_utility_setter_is_rolled_back_and_rejected() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_utility_status(&mut io, 1, 1, 0, 4, 0, 0); // before
        queue_utility_status(&mut io, 1, 1, 0, 4, 0, 0); // write was dropped
        queue_utility_status(&mut io, 1, 1, 0, 4, 0, 0); // rollback verified

        let error = DeviceSession::new(&mut io, profile)
            .set_filter_mode("FAST-PC")
            .await
            .expect_err("a dropped control write must not report success");

        assert!(error.contains("Control verification failed"), "{error}");
        assert!(error.contains("previous settings restored"), "{error}");
        assert_eq!(register_writes(&io, CMD_FILTER_MODE), 2);
        assert_eq!(register_writes(&io, CMD_FLASH_EQ), 2);
    });
}

#[test]
fn a_one_db_mic_volume_difference_is_not_accepted_as_the_requested_value() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_utility_status(&mut io, 1, 1, 0, 4, 0, 0); // before
        queue_utility_status(&mut io, 1, 1, 0, 4, 0, 0); // requested +1 did not land
        queue_utility_status(&mut io, 1, 1, 0, 4, 0, 0); // rollback verified

        let error = DeviceSession::new(&mut io, profile)
            .set_mic_volume(5)
            .await
            .expect_err("the requested mic value must be checked exactly");

        assert!(error.contains("Control verification failed"), "{error}");
        assert!(error.contains("previous settings restored"), "{error}");
    });
}

#[test]
fn control_range_is_checked_before_write() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        let mut session = DeviceSession::new(&mut io, profile);
        assert!(session.set_balance(16).await.is_err());
        assert!(io.writes.is_empty());
    });
}

#[test]
fn non_walkplay_utility_is_rejected_before_write() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x2fc6, 1).unwrap();
        let mut io = FakeIo::default();
        let mut session = DeviceSession::new(&mut io, profile);
        assert!(session.set_gain_mode(true).await.is_err());
        assert!(io.writes.is_empty());
    });
}

#[test]
fn utility_status_propagates_read_failure() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo {
            read_error: Some("simulated read failure".into()),
            ..Default::default()
        };
        let error = DeviceSession::new(&mut io, profile)
            .utility_status()
            .await
            .unwrap_err();
        assert!(error.contains("simulated read failure"));
    });
}

#[test]
fn utility_status_succeeds_with_valid_responses() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // drain terminator
        io.reads.push_back(vec![READ, CMD_FILTER_MODE, 1, 1]); // FAST-LL
        io.reads.push_back(vec![READ, CMD_AMP_MODE, 1, 1]); // Class AB = true
        io.reads.push_back(vec![READ, CMD_GAIN_MODE, 1, 0]); // High gain = false
        io.reads.push_back(vec![READ, CMD_MIC_VOLUME, 2, 128, 5]); // Mic = 5 dB
        io.reads.push_back(vec![READ, CMD_BALANCE, 1, 0, 0, 0]); // Balance L = 0
        io.reads.push_back(vec![READ, CMD_BALANCE, 1, 1, 0, 0]); // Balance R = 0

        let status = DeviceSession::new(&mut io, profile)
            .utility_status()
            .await
            .unwrap();
        assert_eq!(
            status,
            DacUtilityState {
                supported: true,
                filter_mode: "FAST-LL".into(),
                amp_mode_class_ab: true,
                high_gain_mode: false,
                mic_volume_db: 5,
                channel_balance: 0,
            }
        );
    });
}

#[test]
fn utility_status_handles_stale_packets_and_recovers() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // drain terminator
                                    // Several stale non-matching packets before the actual filter response
        for _ in 0..12 {
            io.reads.push_back(vec![READ, 0x99, 0, 0]);
        }
        io.reads.push_back(vec![READ, CMD_FILTER_MODE, 1, 2]); // FAST-PC
        io.reads.push_back(vec![READ, CMD_AMP_MODE, 1, 0]); // Class AB = false
        io.reads.push_back(vec![READ, CMD_GAIN_MODE, 1, 1]); // High gain = true
        io.reads.push_back(vec![READ, CMD_MIC_VOLUME, 2, 128, 0]); // Mic = 0 dB
        io.reads.push_back(vec![READ, CMD_BALANCE, 1, 0, 0, 0]); // Balance L = 0
        io.reads.push_back(vec![READ, CMD_BALANCE, 1, 1, 0, 0]); // Balance R = 0

        let status = DeviceSession::new(&mut io, profile)
            .utility_status()
            .await
            .unwrap();
        assert_eq!(
            status,
            DacUtilityState {
                supported: true,
                filter_mode: "FAST-PC".into(),
                amp_mode_class_ab: false,
                high_gain_mode: true,
                mic_volume_db: 0,
                channel_balance: 0,
            }
        );
    });
}

/// Queues one complete `utility_status` read: the drain terminator, the
/// four register reads, and both balance channels.
fn queue_utility_status(
    io: &mut FakeIo,
    filter_mode: u8,
    amp_mode_class_ab: u8,
    high_gain_mode: u8,
    mic_volume: u8,
    left: u8,
    right: u8,
) {
    use crate::device::families::walkplay as wp;
    io.reads.push_back(vec![]); // drain terminator
    io.reads
        .push_back(vec![READ, wp::CMD_FILTER_MODE, 0, filter_mode]);
    io.reads
        .push_back(vec![READ, wp::CMD_AMP_MODE, 0, amp_mode_class_ab]);
    io.reads
        .push_back(vec![READ, wp::CMD_GAIN_MODE, 0, high_gain_mode]);
    io.reads
        .push_back(vec![READ, wp::CMD_MIC_VOLUME, 0, 0, mic_volume]);
    io.reads
        .push_back(vec![READ, wp::CMD_BALANCE, 0, 0, 0, left]);
    io.reads
        .push_back(vec![READ, wp::CMD_BALANCE, 0, 1, 0, right]);
}
