// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! Synthetic controller, not a hardware capture. Each source-reviewed profile
//! must pass read, destination-before-backup, save, reset, and rollback tests.
use super::*;
use crate::device::{get_supported_device, get_supported_device_with_name, SUPPORTED_DEVICES};
use std::collections::{BTreeMap, VecDeque};

struct HidIo {
    report_id: u8,
    active: u8,
    count: usize,
    banks: BTreeMap<u8, Vec<Vec<u8>>>,
    replies: VecDeque<Vec<u8>>,
    writes: Vec<Vec<u8>>,
    eq_enabled: bool,
    wrong_slot: bool,
    fail_select: bool,
    corrupt_save: bool,
    corrupt_read: bool,
}
impl HidIo {
    fn new(profile: &DeviceProfile) -> Self {
        let protocol = profile.protocol.eq.unwrap();
        let slot = protocol.write_target_preset().unwrap_or(7);
        let count = profile.caps.num_bands;
        Self {
            report_id: protocol.report_id(),
            active: slot + 1,
            count,
            banks: (slot..=slot + 1)
                .chain(protocol.user_eq_slots().iter().copied())
                .map(|slot| {
                    (
                        slot,
                        (0..count)
                            .map(|i| vec![i as u8, 0, slot % 7 + 1, 3, 0xe8, 0, 100, 0])
                            .collect(),
                    )
                })
                .collect(),
            replies: VecDeque::new(),
            writes: vec![],
            eq_enabled: true,
            wrong_slot: false,
            fail_select: false,
            corrupt_save: false,
            corrupt_read: false,
        }
    }
}
impl BlockingDeviceIo for HidIo {
    fn write(&mut self, data: &[u8]) -> Result<(), String> {
        self.writes.push(data.to_vec());
        assert_eq!(data[0], self.report_id);
        let cmd = data[5];
        let p = &data[7..7 + data[6] as usize];
        if data[1] == 0xaa {
            match cmd {
                0x16 => {
                    if self.fail_select {
                        return Err("ambiguous preset delivery".into());
                    }
                    if !self.wrong_slot {
                        self.active = p[0];
                    }
                }
                0x15 => self.banks.get_mut(&self.active).unwrap()[p[0] as usize] = p.to_vec(),
                0x17 => {}
                0x18 => assert_eq!(p[0] as usize, self.count),
                0x19 => {
                    assert_eq!(p[0], self.active);
                    self.replies.push_back(vec![0, 0xee]);
                    self.corrupt_read = self.corrupt_save;
                    self.corrupt_save = false;
                }
                _ => panic!("Unexpected state-changing command {cmd:02x}"),
            }
        } else {
            let payload = match cmd {
                0x18 => vec![self.count as u8],
                0x1a => vec![u8::from(self.eq_enabled)],
                0x16 => vec![self.active],
                0x17 => vec![0, 0],
                0x15 => {
                    let mut band = self.banks[&self.active][p[0] as usize].clone();
                    if self.corrupt_read {
                        band[2] = 100;
                        self.corrupt_read = false;
                    }
                    band
                }
                _ => panic!("Unexpected read {cmd:02x}"),
            };
            let mut reply = vec![0xbb, 0x0b, 0, 0x47, cmd, payload.len() as u8];
            reply.extend(payload);
            reply.extend([0x5a, 0xee, 0xde, 0xad]);
            self.replies.push_back(reply);
        }
        Ok(())
    }
    fn read(&mut self, _: i32) -> Result<Vec<u8>, String> {
        Ok(self.replies.pop_front().unwrap_or_default())
    }
    fn sleep_ms(&mut self, _: u64) {}
}
fn profiles() -> impl Iterator<Item = &'static DeviceProfile> {
    SUPPORTED_DEVICES.iter().filter(|p| {
        p.protocol
            .eq
            .is_some_and(|eq| eq.write_target_preset().is_some())
    })
}
#[test]
fn every_new_hid_profile_reads_resets_saves_and_restores_only_its_destination() {
    block_on(async {
        for profile in profiles() {
            for corrupt in [false, true] {
                let mut io = HidIo::new(profile);
                io.corrupt_save = corrupt;
                let playing = io.active;
                let slot = profile.protocol.eq.unwrap().write_target_preset().unwrap();
                let other = io.banks[&playing].clone();
                let backup = io.banks[&slot].clone();
                {
                    let mut session = DeviceSession::new(&mut io, profile);
                    session.pull().await.unwrap();
                }
                assert_eq!(io.active, playing, "pull changed {}", profile.name);
                assert!(io.writes.iter().all(|p| p[1] == 0xbb));
                let result = DeviceSession::new(&mut io, profile).reset_eq().await;
                if corrupt {
                    assert!(
                        result.unwrap_err().contains("previous state restored"),
                        "{}",
                        profile.name
                    );
                    assert_eq!(io.banks[&slot], backup, "{}", profile.name);
                } else {
                    result.unwrap();
                    assert!(
                        io.banks[&slot].iter().all(|band| band[1..3] == [0, 0]),
                        "{}",
                        profile.name
                    );
                }
                assert_eq!(io.active, slot);
                assert_eq!(io.banks[&playing], other, "{}", profile.name);
                assert!(io
                    .writes
                    .iter()
                    .filter(|p| p[1] == 0xaa && [0x16, 0x19].contains(&p[5]))
                    .all(|p| p[7] == slot));
                assert!(!io.writes.iter().any(|p| p[1] == 0xaa && p[5] == 0x18));
                assert!(!profile.caps.supports_ram_apply);
            }
        }
    });
}
#[test]
fn incompatible_band_counts_fail_before_any_mutation_on_all_new_profiles() {
    block_on(async {
        for profile in profiles() {
            let mut io = HidIo::new(profile);
            io.count += 1;
            let error = DeviceSession::new(&mut io, profile)
                .reset_eq()
                .await
                .unwrap_err();
            assert!(error.contains("reports"), "{error}");
            assert!(io.writes.iter().all(|p| p[1] == 0xbb), "{}", profile.name);
        }
    });
}
#[test]
fn bypassed_eq_is_not_reported_as_a_successful_write() {
    block_on(async {
        for pid in [0x0128, 0xffff] {
            let profile = if pid == 0xffff {
                get_supported_device_with_name(0x2972, pid, Some("FIIO BTR15")).unwrap()
            } else {
                get_supported_device(0x2972, pid).unwrap()
            };
            let mut io = HidIo::new(profile);
            io.eq_enabled = false;
            let error = DeviceSession::new(&mut io, profile)
                .reset_eq()
                .await
                .unwrap_err();
            assert!(error.contains("EQ is disabled"), "{error}");
            assert!(io.writes.iter().all(|p| p[1] == 0xbb));
        }
    });
}
#[test]
fn a_failed_or_wrong_destination_never_writes_eq_or_replays_the_selection() {
    block_on(async {
        let profile = get_supported_device(0x2972, 0x0120).unwrap();
        for delivery_error in [false, true] {
            let mut io = HidIo::new(profile);
            io.wrong_slot = true;
            io.fail_select = delivery_error;
            DeviceSession::new(&mut io, profile)
                .reset_eq()
                .await
                .unwrap_err();
            assert_eq!(io.writes.iter().filter(|p| p[1] == 0xaa).count(), 1);
            assert_eq!(io.writes.iter().find(|p| p[1] == 0xaa).unwrap()[5], 0x16);
        }
    });
}

#[test]
fn editable_user_banks_are_selected_verified_and_saved_independently() {
    block_on(async {
        for profile in SUPPORTED_DEVICES.iter().filter(|p| {
            p.controls != Some(super::super::profile::Controls::Melody)
                && !p.protocol.user_eq_slots().is_empty()
        }) {
            for &slot in profile.protocol.user_eq_slots() {
                for corrupt in [false, true] {
                    let mut io = HidIo::new(profile);
                    let before = io.banks.clone();
                    io.corrupt_save = corrupt;
                    let mut session = DeviceSession::new(&mut io, profile);
                    session.set_user_eq_bank(slot).await.unwrap();
                    session.set_fiio_write_slot(slot).unwrap();
                    let result = session.reset_eq().await;
                    if corrupt {
                        assert!(result.unwrap_err().contains("previous state restored"));
                        assert_eq!(io.banks, before, "{} bank {slot}", profile.name);
                    } else {
                        result.unwrap();
                        assert!(io.banks[&slot].iter().all(|band| band[1..3] == [0, 0]));
                        for (&other, bands) in &before {
                            if other != slot {
                                assert_eq!(
                                    &io.banks[&other], bands,
                                    "{} bank {other}",
                                    profile.name
                                );
                            }
                        }
                    }
                    assert!(io
                        .writes
                        .iter()
                        .filter(|p| p[1] == 0xaa && [0x16, 0x19].contains(&p[5]))
                        .all(|p| p[7] == slot));
                }
            }
        }
    });
}

#[test]
fn invalid_user_banks_fail_without_io_and_wrong_selection_never_writes_eq() {
    block_on(async {
        for profile in SUPPORTED_DEVICES.iter().filter(|p| {
            !p.protocol.user_eq_slots().is_empty()
                && p.controls != Some(super::super::profile::Controls::Melody)
        }) {
            let mut io = HidIo::new(profile);
            {
                let mut session = DeviceSession::new(&mut io, profile);
                assert!(session.set_fiio_write_slot(255).is_err());
                assert!(session.set_user_eq_bank(255).await.is_err());
            }
            assert!(io.writes.is_empty());
            io.wrong_slot = true;
            let slot = profile.protocol.user_eq_slots()[0];
            let mut session = DeviceSession::new(&mut io, profile);
            session.set_fiio_write_slot(slot).unwrap();
            assert!(session.reset_eq().await.is_err());
            assert!(io.writes.iter().all(|p| p[1] != 0xaa || p[5] == 0x16));
        }
    });
}
