// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Application-level error with a semantic kind tag and user-facing message.
#[derive(Error, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[error("{message}")]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: std::borrow::Cow<'static, str>,
    pub context: Option<String>,
}

impl AppError {
    pub fn new(kind: ErrorKind, msg: impl Into<std::borrow::Cow<'static, str>>) -> Self {
        AppError {
            kind,
            message: msg.into(),
            context: None,
        }
    }

    pub fn general(msg: impl Into<std::borrow::Cow<'static, str>>) -> Self {
        AppError::new(ErrorKind::Unknown, msg)
    }

    pub fn with_context(mut self, context: impl Into<String>) -> Self {
        self.context = Some(context.into());
        self
    }

    pub fn user_message(&self) -> String {
        self.kind.to_string()
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::general(s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::general(s.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;

/// Semantic error categories mapped to user-facing messages.
#[derive(Error, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorKind {
    #[error("Device not found. Is it plugged in?")]
    NotConnected,
    #[error("Access denied. Check USB permissions.")]
    PermissionDenied,
    #[error("Device is busy. Another app may be connected.")]
    DeviceBusy,
    #[error("USB read timeout. Try again.")]
    ReadTimeout,
    #[error("USB write failed.")]
    WriteError,
    #[error("Verification failed. Changes not applied.")]
    VerifyFailed,
    #[error("Failed to restore previous settings. Device may be in an inconsistent state.")]
    RollbackFailed,
    #[error("Device disconnected during operation.")]
    DeviceLost,
    #[error("Hardware protocol error.")]
    HardwareError,
    #[error("Failed to parse data.")]
    ParseError,
    #[error("Profile storage error.")]
    StorageError,
    #[error("Invalid or malformed data payload.")]
    InvalidPayload,
    #[error("Operation timed out.")]
    Timeout,
    #[error("Operation cancelled or interrupted.")]
    OperationCancelled,
    #[error("Authentication required. Approve the polkit prompt to access the USB DAC.")]
    PolkitAuthRequired,
    #[error("Unknown error.")]
    Unknown,
}
