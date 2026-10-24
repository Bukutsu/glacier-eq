// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use super::fake::FakeIo;
use super::*;
use crate::device::get_supported_device;

fn melody() -> &'static DeviceProfile {
    get_supported_device(0x2972, 0x0126).unwrap()
}

#[test]
fn sakana2_control_replies_succeed_on_the_first_read_without_replaying_requests() {
    use crate::device::families::fiio::{sakana2, sakana3};
    block_on(async {
        let mut io = FakeIo::default();
        io.reads.extend([
            vec![],
            sakana2::PRESET.to_vec(),
            vec![],
            sakana2::NAME.to_vec(),
            vec![],
            sakana3::NAME_STALE_END.to_vec(),
            vec![],
            sakana2::FIRMWARE_STALE.to_vec(),
            vec![],
            sakana2::FIRMWARE_SHORT.to_vec(),
        ]);
        let mut session = DeviceSession::new(&mut io, melody());
        assert_eq!(session.melody_preset().await, Ok(160));
        assert_eq!(session.melody_name(160).await, Ok("FD15".into()));
        assert_eq!(session.melody_name(160).await, Ok("FD15".into()));
        for _ in 0..2 {
            assert_eq!(session.firmware_version().await, Ok(Some("1.2.0".into())));
        }
        assert_eq!(
            io.writes.len(),
            5,
            "one request per control read, no retries"
        );
    });
}

fn preset_reply(preset: u8) -> Vec<u8> {
    vec![0xbb, 0x0b, 0, 0x21, 0x16, 1, preset, 0x5a, 0xee]
}

#[test]
fn melody_reads_preset_and_firmware() {
    block_on(async {
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // drain
        io.reads.push_back(preset_reply(160));
        io.reads.push_back(vec![]); // drain
        io.reads
            .push_back(vec![0xbb, 0x0b, 0, 0x22, 0x0b, 3, 1, 2, 7, 0x10, 0xee]);
        let mut session = DeviceSession::new(&mut io, melody());
        assert_eq!(session.melody_preset().await, Ok(160));
        assert_eq!(session.firmware_version().await, Ok(Some("1.2.7".into())));
        assert_eq!(
            io.writes,
            [
                vec![7, 0xbb, 0x0b, 0, 0, 0x16, 0, 0, 0xee],
                vec![7, 0xbb, 0x0b, 0, 0, 0x0b, 0, 0, 0xee],
            ]
        );
    });
}

#[test]
fn melody_preset_write_is_sent_once_and_verified() {
    block_on(async {
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]); // drain before the write
        io.reads
            .push_back(vec![0xaa, 0x0a, 0, 0x30, 0x16, 1, 0, 0xa4, 0xee]); // ack
        io.reads.push_back(vec![]); // drain before the readback
        io.reads.push_back(preset_reply(161));
        let mut session = DeviceSession::new(&mut io, melody());
        assert_eq!(session.set_melody_preset(161).await, Ok(161));
        assert_eq!(io.writes[0], [7, 0xaa, 0x0a, 0, 0, 0x16, 1, 161, 0, 0xee]);
        assert_eq!(io.writes.len(), 2);
    });
}

#[test]
fn melody_preset_mismatch_is_an_error_and_is_not_replayed() {
    block_on(async {
        let mut io = FakeIo::default();
        io.reads.push_back(vec![]);
        io.reads.push_back(vec![]);
        io.reads.push_back(preset_reply(0));
        let mut session = DeviceSession::new(&mut io, melody());
        let error = session.set_melody_preset(161).await.unwrap_err();
        assert!(error.contains("expected 161, read 0"), "{error}");
        assert_eq!(
            io.writes
                .iter()
                .filter(|w| w[5] == 0x16 && w[1] == 0xaa)
                .count(),
            1
        );
    });
}

#[test]
fn melody_rejects_unknown_presets_and_other_devices_before_any_io() {
    block_on(async {
        let mut io = FakeIo::default();
        let mut session = DeviceSession::new(&mut io, melody());
        assert!(session.set_melody_preset(9).await.is_err());
        let mut session =
            DeviceSession::new(&mut io, get_supported_device(0x2972, 0x0104).unwrap());
        assert!(session.melody_preset().await.is_err());
        assert_eq!(session.firmware_version().await, Ok(None));
        assert!(io.writes.is_empty());
    });
}

fn name_reply(slot: u8, name: &[u8]) -> Vec<u8> {
    let mut reply = vec![0xbb, 0x0b, 0, 0, 0x30, 9, slot];
    reply.extend_from_slice(name);
    reply.resize(15, 0);
    reply.extend_from_slice(&[0, 0xee, 0x99]);
    reply
}

#[test]
fn melody_name_is_correlated_and_written_once_then_verified() {
    block_on(async {
        let mut io = FakeIo::default();
        io.reads.extend([
            vec![],
            vec![],
            name_reply(160, b"WRONG"),
            name_reply(161, b"TEAPRO2"),
        ]);
        let mut session = DeviceSession::new(&mut io, melody());
        assert_eq!(
            session.set_melody_name(161, "TeaPro2").await.unwrap(),
            "TEAPRO2"
        );
        assert_eq!(io.writes.len(), 2);
        assert_eq!(
            io.writes[0],
            [
                7, 0xaa, 0x0a, 0, 0, 0x30, 8, 161, b'T', b'E', b'A', b'P', b'R', b'O', b'2', 0,
                0xee
            ]
        );
    });
}

#[test]
fn melody_name_and_slot_validation_happen_before_io() {
    block_on(async {
        let mut io = FakeIo::default();
        let mut session = DeviceSession::new(&mut io, melody());
        for name in ["", "123456789", "has space", "日本語", "x!"] {
            assert!(session.set_melody_name(160, name).await.is_err());
        }
        assert!(session.melody_name(0).await.is_err());
        assert!(session.set_melody_write_slot(9).is_err());
        assert!(io.writes.is_empty());
    });
}

#[test]
fn melody_write_delivery_errors_do_not_replay_controls() {
    block_on(async {
        for name in [false, true] {
            let mut io = FakeIo::default();
            io.failing_write_calls.push_back(1);
            let mut session = DeviceSession::new(&mut io, melody());
            let result = if name {
                session.set_melody_name(160, "ABC").await.map(|_| ())
            } else {
                session.set_melody_preset(161).await.map(|_| ())
            };
            assert!(result.is_err());
            assert_eq!(io.writes.len(), 1);
        }
    });
}

#[test]
fn melody_unsolicited_preset_is_unknown_without_io() {
    block_on(async {
        let mut io = FakeIo::default();
        let mut session = DeviceSession::new(&mut io, melody());
        assert!(matches!(
            session
                .execute(DeviceCommand::MelodyControl { value: None })
                .await
                .unwrap(),
            DeviceOutcome::Control(None)
        ));
        assert!(io.writes.is_empty());
    });
}

// Stateful synthetic transport: ordinary reads never switch banks; SAVE's
// acknowledgement is deliberately short and preset reads go stale after EQ I/O.
struct MelodyIo {
    active: u8,
    banks: std::collections::BTreeMap<u8, Vec<Vec<u8>>>,
    gains: std::collections::BTreeMap<u8, Vec<u8>>,
    replies: std::collections::VecDeque<Vec<u8>>,
    writes: Vec<Vec<u8>>,
    fresh_slot: bool,
    corrupt_after_save: bool,
    corrupt_next_band: bool,
    reply_counter: u16,
    framed_replies: bool,
}
impl MelodyIo {
    fn new(corrupt_after_save: bool) -> Self {
        Self {
            active: 162,
            banks: (160..=162)
                .map(|slot| {
                    (
                        slot,
                        (0..10)
                            .map(|i| vec![i, 0, slot - 159, 3, 0xe8, 0, 100, 0])
                            .collect(),
                    )
                })
                .collect(),
            gains: (160..=162).map(|slot| (slot, vec![0, 0])).collect(),
            replies: Default::default(),
            writes: vec![],
            fresh_slot: false,
            corrupt_after_save,
            corrupt_next_band: false,
            reply_counter: 0x00f8,
            framed_replies: false,
        }
    }
}
impl BlockingDeviceIo for MelodyIo {
    fn write(&mut self, data: &[u8]) -> Result<(), String> {
        self.writes.push(data.to_vec());
        let cmd = data[5];
        let p = &data[7..7 + data[6] as usize];
        if data[1] == 0xaa {
            match cmd {
                0x16 => {
                    self.active = p[0];
                    self.fresh_slot = true;
                }
                0x15 => {
                    self.banks.get_mut(&self.active).unwrap()[p[0] as usize] = p.to_vec();
                    self.fresh_slot = false;
                }
                0x17 => {
                    self.gains.insert(self.active, p.to_vec());
                    self.fresh_slot = false;
                }
                0x19 => {
                    assert_eq!(p[0], self.active);
                    self.fresh_slot = true;
                    self.replies.push_back(vec![0, 0xee]);
                    self.corrupt_next_band = self.corrupt_after_save;
                    self.corrupt_after_save = false;
                }
                _ => panic!("Unexpected write command {cmd}"),
            }
        } else {
            let payload = match cmd {
                0x16 => vec![if self.fresh_slot { self.active } else { 9 }],
                0x17 => {
                    self.fresh_slot = false;
                    self.gains[&self.active].clone()
                }
                0x15 => {
                    self.fresh_slot = false;
                    let mut band = self.banks[&self.active][p[0] as usize].clone();
                    if self.corrupt_next_band {
                        band[2] = 100;
                        self.corrupt_next_band = false;
                    }
                    band
                }
                _ => panic!("Unexpected read command {cmd}"),
            };
            let [high, low] = self.reply_counter.to_be_bytes();
            self.reply_counter = self.reply_counter.wrapping_add(1);
            let mut reply = vec![0xbb, 0x0b, high, low, cmd, payload.len() as u8];
            reply.extend(payload);
            reply.extend([0, 0xee]);
            if self.framed_replies {
                reply.insert(0, 7);
                reply.resize(64, 0);
            }
            self.replies.push_back(reply);
        }
        Ok(())
    }
    fn read(&mut self, _: i32) -> Result<Vec<u8>, String> {
        Ok(self.replies.pop_front().unwrap_or_default())
    }
    fn sleep_ms(&mut self, _: u64) {}
    fn reads_include_report_id(&self) -> bool {
        self.framed_replies
    }
}

#[test]
fn melody_framed_sessions_survive_both_counter_rollovers_and_reconnect() {
    block_on(async {
        for counter in [0x00f8, 0xfff8, 0x012c] {
            let mut io = MelodyIo::new(false);
            io.framed_replies = true;
            io.reply_counter = counter;
            {
                let mut session = DeviceSession::new(&mut io, melody());
                session.pull().await.unwrap();
                session.reset_eq().await.unwrap();
            }
            // Opening another session does not reset the hardware's counter.
            let mut session = DeviceSession::new(&mut io, melody());
            assert_eq!(session.pull().await.unwrap().filters.len(), 10);
        }
    });
}

#[test]
fn melody_push_and_reset_target_only_the_chosen_slot_and_rollback_its_backup() {
    block_on(async {
        for corrupt in [false, true] {
            let mut io = MelodyIo::new(corrupt);
            let untouched = io.banks[&162].clone();
            let backup = io.banks[&161].clone();
            {
                let mut session = DeviceSession::new(&mut io, melody());
                // Reading must not select the default write slot.
                session.pull().await.unwrap();
                session.set_melody_write_slot(161).unwrap();
                let result = session.reset_eq().await;
                if corrupt {
                    assert!(result.unwrap_err().contains("previous state restored"));
                } else {
                    assert_eq!(result, Ok(false));
                }
            }
            assert_eq!(io.active, 161);
            assert_eq!(io.banks[&162], untouched);
            if corrupt {
                assert_eq!(io.banks[&161], backup);
            } else {
                assert!(io.banks[&161].iter().all(|band| band[1..3] == [0, 0]));
            }
            assert!(io
                .writes
                .iter()
                .filter(|w| w[1] == 0xaa && [0x16, 0x19].contains(&w[5]))
                .all(|w| w[7] == 161));
            assert!(!io.writes.iter().any(|w| w[5] == 0x18));
        }
    });
}

#[test]
fn experimental_melody_live_writes_only_the_explicit_bank_without_save() {
    block_on(async {
        let mut io = MelodyIo::new(false);
        let requested = {
            let mut session = DeviceSession::new(&mut io, melody());
            session.pull().await.unwrap()
        };
        io.writes.clear();
        let untouched = io.banks[&162].clone();
        let other = io.banks[&160].clone();
        let mut peq = requested;
        peq.filters[0].gain = 4.0;
        {
            let mut session = DeviceSession::new(&mut io, melody());
            let result = session
                .execute(DeviceCommand::LiveApply {
                    peq,
                    melody_slot: Some(161),
                })
                .await;
            if !melody().caps.supports_ram_apply {
                assert!(result.err().unwrap().contains("does not advertise"));
                assert!(io.writes.is_empty());
                return;
            }
            assert!(result.is_ok());
        }
        assert_eq!(io.active, 161);
        assert_eq!(io.banks[&162], untouched);
        assert_eq!(io.banks[&160], other);
        assert!(!io.writes.iter().any(|p| p[5] == 0x19));
        assert_eq!(
            io.writes
                .iter()
                .filter(|p| p[1] == 0xaa && p[5] == 0x15)
                .count(),
            10
        );
    });
}

#[test]
fn melody_live_rejects_missing_or_invalid_bank_before_io() {
    block_on(async {
        let mut io = MelodyIo::new(false);
        let mut session = DeviceSession::new(&mut io, melody());
        assert!(session.set_live_melody_slot(None).is_err());
        assert!(session.set_live_melody_slot(Some(9)).is_err());
        assert!(io.writes.is_empty());
    });
}
