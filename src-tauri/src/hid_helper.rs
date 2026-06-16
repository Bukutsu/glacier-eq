// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: MIT

//! Polkit-elevated HID backend for Linux.
//!
//! When the user lacks udev permissions for a USB DAC, glacier-eq can fall
//! back to spawning a helper process via `pkexec`. The helper runs as root
//! and handles raw HID read/write over JSON-line IPC on stdin/stdout.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::CString;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

// ── IPC protocol ────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct IpcMessage {
    id: u64,
    #[serde(flatten)]
    payload: IpcPayload,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "cmd", content = "args")]
enum IpcPayload {
    Open { path: String },
    Close { path: String },
    Write { path: String, data: Vec<u8> },
    Read { path: String, timeout: i32 },
    Shutdown,
}

#[derive(Serialize, Deserialize)]
struct IpcResponse {
    id: u64,
    #[serde(flatten)]
    payload: IpcResult,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "ok", content = "data")]
enum IpcResult {
    #[serde(rename = "ok")]
    Ok(Option<serde_json::Value>),
    #[serde(rename = "err")]
    Err(String),
}

// ── Elevated transport (main process side) ─────────────────────────────

pub struct ElevatedTransport {
    child: Child,
    stdin: BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

impl ElevatedTransport {
    pub fn spawn() -> Result<Self, String> {
        let exe = std::env::current_exe()
            .map_err(|e| format!("Cannot resolve own path: {e}"))?;

        let mut child = Command::new("pkexec")
            .arg(exe.as_os_str())
            .arg("--hid-helper")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    "pkexec not found. Install polkit (policykit-1) for automatic USB permission elevation.".to_string()
                } else {
                    format!("Failed to launch privileged helper: {e}")
                }
            })?;

        let stdin = BufWriter::new(child.stdin.take().expect("child stdin"));
        let stdout = BufReader::new(child.stdout.take().expect("child stdout"));
        Ok(ElevatedTransport { child, stdin, stdout, next_id: 1 })
    }

    fn round_trip(&mut self, payload: IpcPayload) -> Result<IpcResult, String> {
        let id = self.next_id;
        self.next_id += 1;

        let msg = IpcMessage { id, payload };
        let mut line = serde_json::to_string(&msg)
            .map_err(|e| format!("IPC serialize: {e}"))?;
        line.push('\n');

        self.stdin.write_all(line.as_bytes())
            .and_then(|_| self.stdin.flush())
            .map_err(|e| format!("IPC write: {e}"))?;

        let mut resp_line = String::new();
        self.stdout.read_line(&mut resp_line)
            .map_err(|e| format!("IPC read: {e}"))?;

        let resp: IpcResponse = serde_json::from_str(&resp_line)
            .map_err(|e| format!("IPC parse: {e} (raw: {resp_line:?})"))?;

        Ok(resp.payload)
    }

    pub fn open(&mut self, path: &str) -> Result<(), String> {
        match self.round_trip(IpcPayload::Open { path: path.into() })? {
            IpcResult::Ok(_) => Ok(()),
            IpcResult::Err(e) => Err(e),
        }
    }

    pub fn close(&mut self, path: &str) -> Result<(), String> {
        let _ = self.round_trip(IpcPayload::Close { path: path.into() });
        Ok(())
    }

    pub fn write(&mut self, path: &str, data: &[u8]) -> Result<(), String> {
        match self.round_trip(IpcPayload::Write { path: path.into(), data: data.to_vec() })? {
            IpcResult::Ok(_) => Ok(()),
            IpcResult::Err(e) => Err(e),
        }
    }

    pub fn read(&mut self, path: &str, timeout: i32) -> Result<Vec<u8>, String> {
        match self.round_trip(IpcPayload::Read { path: path.into(), timeout })? {
            IpcResult::Ok(Some(v)) => serde_json::from_value(v)
                .map_err(|e| format!("IPC deser read: {e}")),
            IpcResult::Ok(None) => Ok(vec![]),
            IpcResult::Err(e) => Err(e),
        }
    }
}

impl Drop for ElevatedTransport {
    fn drop(&mut self) {
        let _ = self.round_trip(IpcPayload::Shutdown);
        let _ = self.child.wait();
    }
}

// ── Helper server (--hid-helper process) ────────────────────────────────

pub fn run_helper() -> ! {
    #[cfg(target_os = "linux")]
    unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM); }

    let mut api = match hidapi::HidApi::new() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("glacier-eq --hid-helper: hidapi init failed: {e}");
            std::process::exit(1);
        }
    };
    let mut open: HashMap<String, hidapi::HidDevice> = HashMap::new();
    let stdin = std::io::stdin();
    let reader = BufReader::new(stdin.lock());

    for line_result in reader.lines() {
        let line = match line_result {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() { continue; }

        let msg: IpcMessage = match serde_json::from_str(&line) {
            Ok(m) => m,
            Err(e) => { eprintln!("--hid-helper: bad request: {e}"); continue; }
        };

        let shutdown = matches!(msg.payload, IpcPayload::Shutdown);
        let result = dispatch(&mut api, &mut open, msg.payload);

        if let Ok(json) = serde_json::to_string(&IpcResponse { id: msg.id, payload: result }) {
            println!("{json}");
            let _ = std::io::stdout().flush();
        }

        if shutdown { break; }
    }

    std::process::exit(0);
}

fn dispatch(
    api: &mut hidapi::HidApi,
    open: &mut HashMap<String, hidapi::HidDevice>,
    payload: IpcPayload,
) -> IpcResult {
    match payload {
        IpcPayload::Open { path } => {
            if open.contains_key(&path) {
                return IpcResult::Err("already open".into());
            }
            let cpath = match CString::new(path.as_bytes()) {
                Ok(c) => c,
                Err(_) => return IpcResult::Err("invalid path".into()),
            };
            match api.open_path(&cpath) {
                Ok(dev) => { open.insert(path, dev); IpcResult::Ok(None) }
                Err(e) => IpcResult::Err(format!("open: {e}")),
            }
        }
        IpcPayload::Close { path } => { open.remove(&path); IpcResult::Ok(None) }
        IpcPayload::Write { path, data } => {
            match open.get(&path) {
                Some(dev) => match dev.write(&data) {
                    Ok(_) => IpcResult::Ok(None),
                    Err(e) => IpcResult::Err(format!("write: {e}")),
                },
                None => IpcResult::Err("device not open".into()),
            }
        }
        IpcPayload::Read { path, timeout } => {
            match open.get(&path) {
                Some(dev) => {
                    let mut buf = vec![0u8; 64];
                    match dev.read_timeout(&mut buf, timeout) {
                        Ok(0) => IpcResult::Ok(Some(serde_json::Value::Array(vec![]))),
                        Ok(n) => { buf.truncate(n); IpcResult::Ok(serde_json::to_value(&buf).ok()) }
                        Err(e) => IpcResult::Err(format!("read: {e}")),
                    }
                }
                None => IpcResult::Err("device not open".into()),
            }
        }
        IpcPayload::Shutdown => IpcResult::Ok(None),
    }
}
