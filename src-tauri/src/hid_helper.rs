// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

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
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::thread;
use std::time::Duration;

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
    responses: Receiver<(u64, IpcResult)>,
    next_id: u64,
    /// Set when the helper missed a response deadline or died; the child is
    /// killed and every later request fails fast until the transport is
    /// replaced.
    dead: bool,
}

/// Upper bound for one helper round trip. Device reads are capped at 1 s
/// upstream; writes on a healthy device take milliseconds. A helper wedged on
/// suspended USB I/O must not hold the transport mutex forever.
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(10);

impl ElevatedTransport {
    pub fn spawn() -> Result<Self, String> {
        let exe = std::env::current_exe().map_err(|e| format!("Cannot resolve own path: {e}"))?;

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
        let stdout = child.stdout.take().expect("child stdout");
        let (tx, rx) = std::sync::mpsc::channel();
        thread::spawn(move || read_responses(stdout, tx));
        Ok(ElevatedTransport {
            child,
            stdin,
            responses: rx,
            next_id: 1,
            dead: false,
        })
    }

    /// True once the helper missed a response deadline or its stdout closed.
    /// The caller must drop this transport and spawn a fresh one.
    pub fn is_dead(&self) -> bool {
        self.dead
    }

    fn round_trip(&mut self, payload: IpcPayload) -> Result<IpcResult, String> {
        if self.dead {
            return Err("IPC helper is unresponsive".to_string());
        }
        let id = self.next_id;
        self.next_id += 1;

        let msg = IpcMessage { id, payload };
        let mut line = serde_json::to_string(&msg).map_err(|e| format!("IPC serialize: {e}"))?;
        line.push('\n');

        if let Err(e) = self
            .stdin
            .write_all(line.as_bytes())
            .and_then(|_| self.stdin.flush())
        {
            // A write failure means the pipe or child is gone (e.g. the
            // helper was OOM-killed); flag it so callers replace the
            // transport instead of failing through it forever.
            self.dead = true;
            return Err(format!("IPC write: {e}"));
        }

        loop {
            match self.responses.recv_timeout(RESPONSE_TIMEOUT) {
                Ok((resp_id, resp)) if resp_id == id => return Ok(resp),
                Ok(_) => continue, // stale response from an abandoned request
                Err(RecvTimeoutError::Timeout) => {
                    self.dead = true;
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    return Err("IPC timeout: privileged helper is unresponsive".to_string());
                }
                Err(RecvTimeoutError::Disconnected) => {
                    self.dead = true;
                    let _ = self.child.wait();
                    return Err("IPC read: EOF".to_string());
                }
            }
        }
    }

    pub fn open(&mut self, path: &str) -> Result<(), String> {
        match self.round_trip(IpcPayload::Open { path: path.into() })? {
            IpcResult::Ok(_) => Ok(()),
            IpcResult::Err(e) => Err(e),
        }
    }

    pub fn close(&mut self, path: &str) -> Result<(), String> {
        match self.round_trip(IpcPayload::Close { path: path.into() })? {
            IpcResult::Ok(_) => Ok(()),
            IpcResult::Err(error) => Err(error),
        }
    }

    pub fn write(&mut self, path: &str, data: &[u8]) -> Result<(), String> {
        match self.round_trip(IpcPayload::Write {
            path: path.into(),
            data: data.to_vec(),
        })? {
            IpcResult::Ok(_) => Ok(()),
            IpcResult::Err(e) => Err(e),
        }
    }

    pub fn read(&mut self, path: &str, timeout: i32) -> Result<Vec<u8>, String> {
        match self.round_trip(IpcPayload::Read {
            path: path.into(),
            timeout,
        })? {
            IpcResult::Ok(v) => match v {
                Some(data) => {
                    serde_json::from_value(data).map_err(|e| format!("IPC deser read: {e}"))
                }
                None => Ok(vec![]),
            },
            IpcResult::Err(e) => Err(e),
        }
    }
}

impl Drop for ElevatedTransport {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Reads helper responses on a dedicated thread so `round_trip` can bound its
/// wait with `recv_timeout` instead of blocking forever on `read_line`.
fn read_responses(stdout: ChildStdout, tx: Sender<(u64, IpcResult)>) {
    let mut reader = BufReader::new(stdout);
    loop {
        let mut resp_line = String::new();
        match reader.read_line(&mut resp_line) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let resp: IpcResponse = match serde_json::from_str(&resp_line) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("--hid-helper transport: bad response: {e}");
                break;
            }
        };
        if tx.send((resp.id, resp.payload)).is_err() {
            break;
        }
    }
}

// ── Helper server (--hid-helper process) ────────────────────────────────

pub fn run_helper() -> ! {
    #[cfg(target_os = "linux")]
    unsafe {
        libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
    }

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
        if line.trim().is_empty() {
            continue;
        }

        let msg: IpcMessage = match serde_json::from_str(&line) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("--hid-helper: bad request: {e}");
                continue;
            }
        };

        let shutdown = matches!(msg.payload, IpcPayload::Shutdown);
        let result = dispatch(&mut api, &mut open, msg.payload);

        if let Ok(json) = serde_json::to_string(&IpcResponse {
            id: msg.id,
            payload: result,
        }) {
            println!("{json}");
            let _ = std::io::stdout().flush();
        }

        if shutdown {
            break;
        }
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
            // Running as root, this helper must not become a generic HID
            // read/write oracle if the unprivileged main process is
            // compromised: only open paths whose VID:PID belongs to a
            // supported DAC.
            let supported = api.device_list().any(|info| {
                info.path() == cpath.as_c_str()
                    && glacier_core::device::get_supported_device(
                        info.vendor_id(),
                        info.product_id(),
                    )
                    .is_some()
            });
            if !supported {
                return IpcResult::Err("refused: device is not a supported DAC".into());
            }
            match api.open_path(&cpath) {
                Ok(dev) => {
                    // hidraw nodes can be reassigned between the enumeration
                    // above and this open; refuse whatever we actually got.
                    let opened_ok = dev.get_device_info().is_ok_and(|info| {
                        glacier_core::device::get_supported_device(
                            info.vendor_id(),
                            info.product_id(),
                        )
                        .is_some()
                    });
                    if !opened_ok {
                        return IpcResult::Err("refused: device changed while opening".into());
                    }
                    open.insert(path, dev);
                    IpcResult::Ok(None)
                }
                Err(e) => IpcResult::Err(format!("open: {e}")),
            }
        }
        IpcPayload::Close { path } => {
            open.remove(&path);
            IpcResult::Ok(None)
        }
        IpcPayload::Write { path, data } => match open.get(&path) {
            Some(dev) => match dev.write(&data) {
                Ok(_) => IpcResult::Ok(None),
                Err(e) => IpcResult::Err(format!("write: {e}")),
            },
            None => IpcResult::Err("device not open".into()),
        },
        IpcPayload::Read { path, timeout } => match open.get(&path) {
            Some(dev) => {
                let mut buf = vec![0u8; 1024];
                match dev.read_timeout(&mut buf, timeout) {
                    Ok(0) => IpcResult::Ok(Some(serde_json::Value::Array(vec![]))),
                    Ok(n) => {
                        buf.truncate(n);
                        IpcResult::Ok(serde_json::to_value(&buf).ok())
                    }
                    Err(e) => IpcResult::Err(format!("read: {e}")),
                }
            }
            None => IpcResult::Err("device not open".into()),
        },
        IpcPayload::Shutdown => IpcResult::Ok(None),
    }
}
