// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! SNOWSKY Melody controls on the shared async session (native HID and WebHID).
//! Codec and provenance: `families::fiio::melody`. Read-only requests are
//! repeated; the preset write is sent once and then verified by readback.

use super::{DeviceIo, DeviceSession};
use crate::device::{families::fiio::melody, profile::Controls, Packet};

const READ_ATTEMPTS: usize = 3;
const REPLY_POLLS: usize = 20;

impl<I: DeviceIo> DeviceSession<'_, I> {
    pub fn require_melody(&self) -> Result<(), String> {
        self.require_open_transaction()?;
        if self.profile.controls == Some(Controls::Melody) {
            Ok(())
        } else {
            Err("These controls require a SNOWSKY Melody or Tiny A".into())
        }
    }

    async fn melody_read<T>(
        &mut self,
        label: &str,
        request: Packet,
        parse: impl Fn(&[u8]) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut last = format!("{label} read timeout");
        for _ in 0..READ_ATTEMPTS {
            self.drain().await;
            self.send(&request).await?;
            match self
                .read_matching(label, REPLY_POLLS, |data| parse(data).is_ok())
                .await
            {
                Ok(data) => return parse(&data),
                Err(error) => last = error.into(),
            }
        }
        Err(last)
    }

    /// Per-operation destination. Ordinary reads never select a bank.
    pub fn set_melody_write_slot(&mut self, slot: u8) -> Result<(), String> {
        self.require_melody()?;
        melody::require_user_slot(slot)?;
        self.melody_write_slot = slot;
        Ok(())
    }

    pub async fn melody_name(&mut self, slot: u8) -> Result<String, String> {
        self.require_melody()?;
        self.melody_read("Melody name", melody::name_request(slot)?, |data| {
            melody::parse_name(data, slot)
        })
        .await
    }

    pub async fn set_melody_name(&mut self, slot: u8, name: &str) -> Result<String, String> {
        self.require_melody()?;
        let expected = melody::normalize_name(name)?;
        let packet = melody::name_write(slot, &expected)?;
        self.drain().await;
        self.io.write(&packet.framed()).await?;
        let actual = self.melody_name(slot).await?;
        if actual != expected {
            return Err(format!(
                "Melody name verification failed: expected {expected}, read {actual}"
            ));
        }
        Ok(actual)
    }

    // Only trustworthy immediately after a select or SAVE. Do not expose an
    // arbitrary query as confirmed UI state: band/preamp traffic makes it stale.
    pub async fn melody_preset(&mut self) -> Result<u8, String> {
        self.require_melody()?;
        self.melody_read(
            "Melody preset",
            melody::preset_request(),
            melody::parse_preset,
        )
        .await
    }

    pub(crate) async fn melody_firmware(&mut self) -> Result<Option<String>, String> {
        self.require_melody()?;
        self.melody_read(
            "Melody firmware",
            melody::firmware_request(),
            melody::parse_firmware,
        )
        .await
        .map(Some)
    }

    /// Selects a preset and returns the value the DAC reports afterwards.
    /// A mismatch is an error: the write is never repeated.
    pub async fn set_melody_preset(&mut self, preset: u8) -> Result<u8, String> {
        self.require_melody()?;
        let packet = melody::preset_write(preset)?;
        self.drain().await;
        self.io.write(&packet.framed()).await?;
        let actual = self.melody_preset().await?;
        if actual == preset {
            Ok(actual)
        } else {
            Err(format!(
                "Melody preset verification failed: expected {preset}, read {actual}"
            ))
        }
    }
}
