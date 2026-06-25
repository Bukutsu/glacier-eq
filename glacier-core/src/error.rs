// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use thiserror::Error;

/// Application-level error.
#[derive(Error, Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[error("{message}")]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: Cow<'static, str>,
}

impl AppError {
    pub fn new(kind: ErrorKind, msg: impl Into<Cow<'static, str>>) -> Self {
        AppError {
            kind,
            message: msg.into(),
        }
    }

    pub fn general(msg: impl Into<Cow<'static, str>>) -> Self {
        AppError::new(ErrorKind::Unknown, msg)
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
    #[error("Unknown error.")]
    Unknown,
}
