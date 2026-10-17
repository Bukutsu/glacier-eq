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

    /// None means the single write was sent, but readback did not verify it.
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
        // Mic/UAC may change USB interfaces, but are not PEQ Save. Do not mark
        // this transaction as restarted without observing a disconnect, and
        // never retry the mutation or synthesize a save/restart command.
        self.io.write(&packet.framed()).await?;
        // Cyfine writeAndVerify uses a 200 ms command interval. Keep the shared
        // read's existing 500 ms settle as well, then one request with bounded
        // 20 x 60 ms receives on the same live transport. No read-request retry.
        self.io.sleep_ms(200).await;
        match self.ja11_control(control).await {
            Ok(actual) if actual == value => Ok(Some(actual)),
            result if control == "volume" => Err(match result {
                Ok(actual) => {
                    format!("JA11 volume verification failed: expected {value}, read {actual}")
                }
                Err(error) => error,
            }),
            Err(error) if crate::error::is_disconnection(&error) => Err(error),
            _ => Ok(None),
        }
    }
}
