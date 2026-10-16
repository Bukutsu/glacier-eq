// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use super::*;
use crate::device::get_supported_device;
use crate::device::session::fake::FakeIo;

#[test]
fn a_failed_control_reset_restores_the_settings_that_already_landed() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        // The device is on a non-default filter mode, Class-AB, high gain,
        // mic +4 dB, balanced. Every set_* below sends its register write and
        // then commits to flash, so a failure part-way through would leave
        // those durable changes on the hardware with no way back.
        queue_utility_status(&mut io, 2, 1, 1, 4, 0, 0);
        // The snapshot's six register reads are writes 1..6. The reset's first
        // two steps then take writes 7..10 (register write plus flash commit
        // each). Fail every attempt of the third step's register write —
        // send() retries three times — so the filter and amp modes are already
        // committed to flash when the gain step gives up, and let the rollback
        // through.
        io.failing_write_calls.extend([11, 12, 13]);
        queue_utility_status(&mut io, 1, 0, 0, 0, 0, 0);
        queue_utility_status(&mut io, 2, 1, 1, 4, 0, 0);

        let error = DeviceSession::new(&mut io, profile)
            .reset_controls()
            .await
            .expect_err("a half-applied reset must not report success");
        assert!(
            error.contains("previous settings restored"),
            "the error must name the rollback: {error}"
        );
        // The rollback re-sent the original filter mode, so a write carrying
        // CMD_FLASH_EQ for it is on the wire after the failure.
        assert!(
            io.writes
                .iter()
                .any(|write| write.get(2) == Some(&super::super::CMD_FLASH_EQ)),
            "rollback writes were not attempted"
        );
    });
}

#[test]
fn a_successful_control_reset_does_not_roll_back() {
    crate::device::session::block_on(async {
        let profile = get_supported_device(0x3302, 0x43e8).unwrap();
        let mut io = FakeIo::default();
        queue_utility_status(&mut io, 2, 1, 1, 4, 0, 0);
        queue_utility_status(&mut io, 1, 0, 0, 0, 0, 0);

        let state = DeviceSession::new(&mut io, profile)
            .reset_controls()
            .await
            .expect("a clean reset must succeed");
        assert_eq!(state.filter_mode, "FAST-LL");
        assert!(!state.amp_mode_class_ab);
        assert!(!state.high_gain_mode);
        assert_eq!(state.mic_volume_db, 0);
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
