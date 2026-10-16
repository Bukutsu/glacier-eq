// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

//! JA11 controls use the same async session on native HID and WebHID.
//! Source-reviewed, not hardware-verified. No PEQ save or speculative recovery.

use super::{DeviceIo, DeviceSession};
use crate::device::{families::fiio::ja11, profile::Controls};

impl<I: DeviceIo> DeviceSession<'_, I> {
    fn require_ja11(&self) -> Result<(), String> {
        self.require_open_transaction()?;
        if self.profile.controls == Some(Controls::Ja11) {
            Ok(())
        } else {
            Err("These controls require a JA11".into())
        }
    }

    pub async fn ja11_control(&mut self, control: &str) -> Result<u8, String> {
        self.require_ja11()?;
        let request = ja11::request(control)?;
        // Also settles a freshly opened interface and spaces adjacent operations.
        self.io.sleep_ms(500).await;
        self.drain().await;
        // Single-shot: late uncorrelated replies must not satisfy a retry.
        self.io.write(&request.framed()).await?;
        self.io.sleep_ms(200).await;
        let data = self
            .read_matching("JA11 control", 20, |data| {
                ja11::parse(control, data).is_ok()
            })
            .await?;
        ja11::parse(control, &data)
    }

    /// None means sent only; reconnect and read to verify microphone/UAC.
    pub async fn set_ja11_control(
        &mut self,
        control: &str,
        value: u8,
    ) -> Result<Option<u8>, String> {
        self.require_ja11()?;
        let packet = ja11::write(control, value)?;
        // Never mutate on a missing/malformed pre-read, or substitute a default.
        let current = self.ja11_control(control).await?;
        if current == value {
            return Ok(Some(current));
        }
        if control != "volume" {
            // An error may still mean delivered. No retries or post-write I/O.
            self.progress("Sending JA11 setting (restart expected)…", 80.0);
            self.restart_attempted = true;
        }
        self.io.write(&packet.framed()).await?;
        self.io.sleep_ms(200).await;
        if control != "volume" {
            return Ok(None);
        }
        let actual = self.ja11_control(control).await?;
        if actual != value {
            return Err(format!(
                "JA11 volume verification failed: expected {value}, read {actual}"
            ));
        }
        Ok(Some(actual))
    }
}
