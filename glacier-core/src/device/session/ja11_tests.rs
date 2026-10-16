// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use super::fake::{FakeIo, IoEvent};
use super::*;
use crate::device::get_supported_device;

fn peq() -> PEQData {
    PEQData {
        global_gain: -3.9,
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
    }
}

fn queue_pull(io: &mut FakeIo) {
    io.reads.push_back(vec![]); // settle/drain
    io.reads
        .push_back(vec![0xbb, 0x0b, 0, 0, 0x17, 2, 0xff, 0xd9, 0, 0xee]);
    for index in 0..5 {
        io.reads.push_back(vec![
            0xbb, 0x0b, 0, 0, 0x15, 8, index, 0, 10, 3, 0xe8, 0, 100, 0, 0, 0xee,
        ]);
    }
}

fn assert_pacing(io: &FakeIo) {
    let mut since_write: Option<u64> = None;
    assert_eq!(io.events.first(), Some(&IoEvent::Sleep(500)));
    for event in &io.events {
        match event {
            IoEvent::Write(_) => {
                assert!(since_write.is_none_or(|ms| ms >= 200), "{:?}", io.events);
                since_write = Some(0);
            }
            IoEvent::Sleep(ms) => since_write = since_write.map(|total| total + ms),
            IoEvent::Read => {}
        }
    }
}

#[test]
fn ja11_order_timing_signed_gain_and_save_boundary_on_both_pids() {
    block_on(async {
        for pid in [0x0101, 0x0102] {
            for skip_verification in [false, true] {
                for save_error in [false, true] {
                    let profile = get_supported_device(0x2972, pid).unwrap();
                    let mut io = FakeIo::default();
                    queue_pull(&mut io);
                    io.reads.push_back(vec![]); // write init drain
                    if !skip_verification {
                        queue_pull(&mut io);
                    }
                    // snapshot: 6 reads; RAM write: select + 5 bands + preamp + Apply;
                    // verification: 6 reads, then final single-shot Save.
                    let save_call = if skip_verification { 15 } else { 21 };
                    if save_error {
                        io.failing_write_calls.push_back(save_call);
                    }
                    let mut session = DeviceSession::new(&mut io, profile);
                    let result = session
                        .execute(DeviceCommand::Push {
                            peq: peq(),
                            skip_verification,
                        })
                        .await;
                    if save_error {
                        assert!(result.err().unwrap().contains("delivery uncertain"));
                    } else {
                        match result.unwrap() {
                            DeviceOutcome::Write(outcome) => {
                                assert!(outcome.restarts);
                                assert_eq!(outcome.warnings.len(), usize::from(skip_verification));
                            }
                            _ => panic!("wrong outcome"),
                        }
                    }
                    // Even an ambiguous error consumes the transaction.
                    assert!(session
                        .pull()
                        .await
                        .unwrap_err()
                        .contains("restart write attempted"));
                    drop(session);
                    assert_eq!(io.writes.len(), save_call);
                    let sets: Vec<_> = io.writes.iter().filter(|p| p[1] == 0xaa).collect();
                    assert_eq!(
                        sets.iter().map(|p| p[5]).collect::<Vec<_>>(),
                        [0x16, 0x15, 0x15, 0x15, 0x15, 0x15, 0x17, 0x18, 0x19]
                    );
                    assert_eq!(sets[0][7], 3);
                    assert_eq!(&sets[6][7..9], &[0xff, 0xd9]);
                    assert_eq!(
                        sets[7].as_slice(),
                        [2, 0xaa, 0x0a, 0, 0, 0x18, 1, 1, 0, 0xee]
                    );
                    assert_eq!(
                        sets[8].as_slice(),
                        [2, 0xaa, 0x0a, 0, 0, 0x19, 1, 3, 0, 0xee]
                    );
                    let last_write = io
                        .events
                        .iter()
                        .rposition(|e| matches!(e, IoEvent::Write(_)))
                        .unwrap();
                    assert!(!io.events[last_write + 1..]
                        .iter()
                        .any(|e| matches!(e, IoEvent::Read | IoEvent::Write(_))));
                    assert_pacing(&io);
                }
            }
        }
    });
}

fn reply(cmd: u8, value: u8) -> Vec<u8> {
    vec![0xbb, 0x0b, 0, 0, cmd, 1, value, 0, 0xee]
}

#[test]
fn controls_fresh_read_volume_verification_and_restart_results() {
    block_on(async {
        for pid in [0x0101, 0x0102] {
            let profile = get_supported_device(0x2972, pid).unwrap();
            let mut io = FakeIo::default();
            io.reads
                .extend([vec![], reply(2, 30), vec![], reply(2, 29)]);
            assert_eq!(
                DeviceSession::new(&mut io, profile)
                    .set_ja11_control("volume", 29)
                    .await
                    .unwrap(),
                Some(29)
            );
            assert_eq!(
                io.writes,
                [
                    vec![2, 0xbb, 0x0b, 0, 0, 2, 0, 0, 0xee],
                    vec![2, 0xaa, 0x0a, 0, 0, 2, 1, 29, 0, 0xee],
                    vec![2, 0xbb, 0x0b, 0, 0, 2, 0, 0, 0xee],
                ]
            );
            assert_pacing(&io);
            for (control, cmd) in [("microphone", 0x12), ("uac", 0x20)] {
                for write_error in [false, true] {
                    let mut io = FakeIo::default();
                    io.reads.extend([vec![], reply(cmd, 1)]);
                    if write_error {
                        io.failing_write_calls.push_back(2);
                    }
                    let mut session = DeviceSession::new(&mut io, profile);
                    let result = session.set_ja11_control(control, 0).await;
                    if write_error {
                        assert!(result.is_err());
                    } else {
                        assert_eq!(result.unwrap(), None);
                    }
                    assert!(session.ja11_control(control).await.is_err());
                    drop(session);
                    assert_eq!(io.writes.len(), 2);
                    assert_eq!(io.writes[1], vec![2, 0xaa, 0x0a, 0, 0, cmd, 1, 0, 0, 0xee]);
                    assert_pacing(&io);
                }
            }
        }
    });
}

#[test]
fn controls_refuse_bad_reads_ranges_other_models_and_volume_mismatch() {
    block_on(async {
        let profile = get_supported_device(0x2972, 0x0102).unwrap();
        for (control, value) in [
            ("volume", 61),
            ("microphone", 2),
            ("uac", 2),
            ("unknown", 0),
        ] {
            let mut io = FakeIo::default();
            assert!(DeviceSession::new(&mut io, profile)
                .set_ja11_control(control, value)
                .await
                .is_err());
            assert!(io.events.is_empty());
        }
        for pid in [0x0104, 0x0093] {
            let mut io = FakeIo::default();
            let profile = get_supported_device(0x2972, pid).unwrap();
            assert!(DeviceSession::new(&mut io, profile)
                .set_ja11_control("volume", 20)
                .await
                .is_err());
            assert!(io.events.is_empty());
        }
        let mut io = FakeIo::default();
        let mut bad = reply(2, 30);
        bad[5] = 2;
        io.reads.extend([vec![], bad]);
        assert!(DeviceSession::new(&mut io, profile)
            .set_ja11_control("volume", 20)
            .await
            .is_err());
        assert_eq!(io.writes.len(), 1); // pre-read only, no retry, mutation or save
        let mut io = FakeIo::default();
        io.reads
            .extend([vec![], reply(2, 30), vec![], reply(2, 28)]);
        assert!(DeviceSession::new(&mut io, profile)
            .set_ja11_control("volume", 29)
            .await
            .unwrap_err()
            .contains("verification failed"));
        assert_eq!(io.writes.len(), 3); // no rollback or save
        let mut io = FakeIo::default();
        io.reads.extend([vec![], reply(2, 30)]);
        assert_eq!(
            DeviceSession::new(&mut io, profile)
                .set_ja11_control("volume", 30)
                .await
                .unwrap(),
            Some(30)
        );
        assert_eq!(io.writes.len(), 1); // already current; no write
    });
}
