// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

use glacier_core::autoeq::{
    autoeq_token, parse_autoeq_text, parse_curve_text, peq_to_autoeq, run_autoeq,
};
use glacier_core::device::{capabilities::DESKTOP_DAC_CAPS, get_supported_device};
use glacier_core::eq::iir_math::accumulate_response_values;
use glacier_core::profiles::ProfileStore;
use glacier_core::{DeviceCapabilities, PEQData, SUPPORTED_DEVICES};
#[cfg(not(any(target_os = "android", target_os = "ios", target_arch = "wasm32")))]
use glacier_core::{DeviceIo, DeviceSession};
use std::io::Read;
use std::process::ExitCode;

const HELP: &str = "Glacier EQ CLI

Usage:
  glacier-eq-cli devices
  glacier-eq-cli inspect [FILE|-]
  glacier-eq-cli normalize [FILE|-] [VID:PID]
  glacier-eq-cli response [FILE|-] [SAMPLE_RATE]
  glacier-eq-cli hardware list
  glacier-eq-cli hardware pull [--device PATH|VID:PID]
  glacier-eq-cli hardware push FILE [--device SELECTOR] --yes
  glacier-eq-cli hardware apply FILE [--device SELECTOR] --yes
  glacier-eq-cli autoeq MEASUREMENT TARGET [--bands N] [--steps N]
      [--smooth none|ie|oe] [--sample-rate HZ] [--device VID:PID]
  glacier-eq-cli profile list
  glacier-eq-cli profile show NAME
  glacier-eq-cli profile save NAME FILE [--yes]
  glacier-eq-cli profile delete NAME --yes
  glacier-eq-cli controls status [--device SELECTOR]
  glacier-eq-cli controls filter MODE|amp a|ab|gain low|high [--device SELECTOR] --yes
  glacier-eq-cli controls balance -15..15|mic -15..15 [--device SELECTOR] --yes
  glacier-eq-cli controls reset eq|controls|factory [--device SELECTOR] --yes

FILE defaults to stdin only for inspect/normalize/response. Mutations require --yes.
If --device is omitted, exactly one supported HID device must be attached.
AutoEQ and pulled profiles go to stdout; diagnostics go to stderr.
";

#[derive(Debug, PartialEq)]
enum Command {
    Help,
    Devices,
    Inspect(String),
    Normalize(String, Option<String>),
    Response(String, f64),
    Hardware {
        action: HardwareAction,
        selector: Option<String>,
        yes: bool,
    },
    AutoEq {
        measurement: String,
        target: String,
        bands: usize,
        steps: usize,
        smooth: String,
        sample_rate: f32,
        device: Option<String>,
    },
    Profile(ProfileAction),
    Controls {
        action: ControlAction,
        selector: Option<String>,
        yes: bool,
    },
}

#[derive(Debug, PartialEq)]
enum HardwareAction {
    List,
    Pull,
    Push(String),
    Apply(String),
}

#[derive(Debug, PartialEq)]
enum ProfileAction {
    List,
    Show(String),
    Save {
        name: String,
        file: String,
        yes: bool,
    },
    Delete {
        name: String,
        yes: bool,
    },
}

#[derive(Debug, PartialEq)]
enum ControlAction {
    Status,
    Filter(String),
    Amp(bool),
    Gain(bool),
    Balance(i8),
    Mic(i8),
    Reset(String),
}

fn main() -> ExitCode {
    match parse(std::env::args().skip(1).collect()).and_then(execute) {
        Ok(output) => {
            print!("{output}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn parse(args: Vec<String>) -> Result<Command, String> {
    match args.first().map(String::as_str) {
        None | Some("help" | "--help" | "-h") => Ok(Command::Help),
        Some("devices") if args.len() == 1 => Ok(Command::Devices),
        Some("inspect") if args.len() <= 2 => Ok(Command::Inspect(
            args.get(1).cloned().unwrap_or_else(|| "-".into()),
        )),
        Some("normalize") if args.len() <= 3 => Ok(Command::Normalize(
            args.get(1).cloned().unwrap_or_else(|| "-".into()),
            args.get(2).cloned(),
        )),
        Some("response") if args.len() <= 3 => Ok(Command::Response(
            args.get(1).cloned().unwrap_or_else(|| "-".into()),
            args.get(2)
                .map_or(Ok(96_000.0), |value| number(value, "sample rate"))?,
        )),
        Some("hardware") => parse_hardware(&args[1..]),
        Some("autoeq") => parse_autoeq_command(&args[1..]),
        Some("profile") => parse_profile(&args[1..]),
        Some("controls") => parse_controls(&args[1..]),
        Some(command) => Err(format!("unknown command or extra arguments: {command}")),
    }
}

fn parse_hardware(args: &[String]) -> Result<Command, String> {
    let (mut args, selector, yes) = common_device_options(args)?;
    let action = match args.first().map(String::as_str) {
        Some("list") if args.len() == 1 && selector.is_none() => HardwareAction::List,
        Some("pull") if args.len() == 1 => HardwareAction::Pull,
        Some("push") if args.len() == 2 => HardwareAction::Push(args.remove(1)),
        Some("apply") if args.len() == 2 => HardwareAction::Apply(args.remove(1)),
        _ => return Err("invalid hardware command".into()),
    };
    Ok(Command::Hardware {
        action,
        selector,
        yes,
    })
}

fn parse_autoeq_command(args: &[String]) -> Result<Command, String> {
    let mut args = args.to_vec();
    let bands =
        take_option(&mut args, "--bands")?.map_or(Ok(10), |value| integer(&value, "bands"))?;
    let steps =
        take_option(&mut args, "--steps")?.map_or(Ok(2000), |value| integer(&value, "steps"))?;
    let smooth = take_option(&mut args, "--smooth")?.unwrap_or_else(|| "ie".into());
    let sample_rate = take_option(&mut args, "--sample-rate")?
        .map_or(Ok(96_000.0), |value| number(&value, "sample rate"))?;
    let device = take_option(&mut args, "--device")?;
    if args.len() != 2 {
        return Err("autoeq requires MEASUREMENT and TARGET files".into());
    }
    Ok(Command::AutoEq {
        measurement: args.remove(0),
        target: args.remove(0),
        bands,
        steps,
        smooth,
        sample_rate,
        device,
    })
}

fn parse_profile(args: &[String]) -> Result<Command, String> {
    let mut args = args.to_vec();
    let yes = take_flag(&mut args, "--yes");
    let action = match args.first().map(String::as_str) {
        Some("list") if args.len() == 1 && !yes => ProfileAction::List,
        Some("show") if args.len() == 2 && !yes => ProfileAction::Show(args.remove(1)),
        Some("save") if args.len() == 3 => ProfileAction::Save {
            name: args[1].clone(),
            file: args[2].clone(),
            yes,
        },
        Some("delete") if args.len() == 2 => ProfileAction::Delete {
            name: args[1].clone(),
            yes,
        },
        _ => return Err("invalid profile command".into()),
    };
    Ok(Command::Profile(action))
}

fn parse_controls(args: &[String]) -> Result<Command, String> {
    let (mut args, selector, yes) = common_device_options(args)?;
    let action = match args.first().map(String::as_str) {
        Some("status") if args.len() == 1 => ControlAction::Status,
        Some("filter") if args.len() == 2 => ControlAction::Filter(args.remove(1)),
        Some("amp") if args.len() == 2 => ControlAction::Amp(match args[1].as_str() {
            "a" | "class-a" => false,
            "ab" | "class-ab" => true,
            _ => return Err("amp mode must be a or ab".into()),
        }),
        Some("gain") if args.len() == 2 => ControlAction::Gain(match args[1].as_str() {
            "low" => false,
            "high" => true,
            _ => return Err("gain must be low or high".into()),
        }),
        Some("balance") if args.len() == 2 => ControlAction::Balance(number(&args[1], "balance")?),
        Some("mic") if args.len() == 2 => ControlAction::Mic(number(&args[1], "mic")?),
        Some("reset")
            if args.len() == 2 && matches!(args[1].as_str(), "eq" | "controls" | "factory") =>
        {
            ControlAction::Reset(args.remove(1))
        }
        _ => return Err("invalid controls command".into()),
    };
    Ok(Command::Controls {
        action,
        selector,
        yes,
    })
}

fn common_device_options(args: &[String]) -> Result<(Vec<String>, Option<String>, bool), String> {
    let mut args = args.to_vec();
    let selector = take_option(&mut args, "--device")?;
    let yes = take_flag(&mut args, "--yes");
    Ok((args, selector, yes))
}

fn take_option(args: &mut Vec<String>, name: &str) -> Result<Option<String>, String> {
    let Some(index) = args.iter().position(|argument| argument == name) else {
        return Ok(None);
    };
    if index + 1 >= args.len() || args[index + 1].starts_with("--") {
        return Err(format!("{name} requires a value"));
    }
    let value = args.remove(index + 1);
    args.remove(index);
    if args.iter().any(|argument| argument == name) {
        return Err(format!("{name} may be specified once"));
    }
    Ok(Some(value))
}

fn take_flag(args: &mut Vec<String>, name: &str) -> bool {
    let found = args.iter().any(|argument| argument == name);
    args.retain(|argument| argument != name);
    found
}

fn number<T: std::str::FromStr>(value: &str, label: &str) -> Result<T, String> {
    value
        .parse()
        .map_err(|_| format!("invalid {label}: {value}"))
}

fn integer(value: &str, label: &str) -> Result<usize, String> {
    number(value, label)
}

fn execute(command: Command) -> Result<String, String> {
    require_confirmation(&command)?;
    match command {
        Command::Help => Ok(HELP.into()),
        Command::Devices => Ok(supported_devices()),
        Command::Inspect(path) => inspect(&path),
        Command::Normalize(path, device) => normalize(&path, device.as_deref()),
        Command::Response(path, sample_rate) => response(&path, sample_rate),
        Command::Hardware {
            action, selector, ..
        } => execute_hardware(action, selector.as_deref()),
        Command::AutoEq {
            measurement,
            target,
            bands,
            steps,
            smooth,
            sample_rate,
            device,
        } => autoeq(
            &measurement,
            &target,
            bands,
            steps,
            &smooth,
            sample_rate,
            device.as_deref(),
        ),
        Command::Profile(action) => execute_profile(action),
        Command::Controls {
            action, selector, ..
        } => execute_controls(action, selector.as_deref()),
    }
}

fn require_confirmation(command: &Command) -> Result<(), String> {
    let confirmed = match command {
        Command::Hardware { action, yes, .. } => {
            !matches!(action, HardwareAction::Push(_) | HardwareAction::Apply(_)) || *yes
        }
        Command::Controls { action, yes, .. } => matches!(action, ControlAction::Status) || *yes,
        Command::Profile(ProfileAction::Delete { yes, .. }) => *yes,
        _ => true,
    };
    if confirmed {
        Ok(())
    } else {
        Err("mutation requires explicit --yes".into())
    }
}

const MAX_TEXT_BYTES: u64 = 1 << 20;

fn read_text(path: &str) -> Result<String, String> {
    let mut text = String::new();
    if path == "-" {
        std::io::stdin()
            .take(MAX_TEXT_BYTES + 1)
            .read_to_string(&mut text)
            .map_err(|error| format!("failed to read stdin: {error}"))?;
    } else {
        let metadata =
            std::fs::metadata(path).map_err(|error| format!("failed to stat {path}: {error}"))?;
        if metadata.len() > MAX_TEXT_BYTES {
            return Err(format!(
                "input file exceeds {} MiB",
                MAX_TEXT_BYTES / (1 << 20)
            ));
        }
        text = std::fs::read_to_string(path)
            .map_err(|error| format!("failed to read {path}: {error}"))?;
    }
    if text.len() as u64 > MAX_TEXT_BYTES {
        return Err("input exceeds 1 MiB".into());
    }
    Ok(text)
}

fn read_peq(path: &str) -> Result<(PEQData, Option<String>, Vec<String>), String> {
    parse_autoeq_text(&read_text(path)?)
}

fn supported_devices() -> String {
    let mut output = String::from("usb_id,bands,protocol,status,device\n");
    for device in SUPPORTED_DEVICES {
        let id = device.product_id.map_or_else(
            || format!("{:04x}:*", device.vendor_id),
            |product| format!("{:04x}:{product:04x}", device.vendor_id),
        );
        output.push_str(&format!(
            "{id},{},{},{},{}\n",
            device.caps.num_bands,
            device.protocol.name(),
            device.status,
            device.name
        ));
    }
    output
}

fn inspect(path: &str) -> Result<String, String> {
    let (peq, name, warnings) = read_peq(path)?;
    let mut output = String::new();
    if let Some(name) = name {
        output.push_str(&format!("Profile: {name}\n"));
    }
    output.push_str(&format!(
        "Preamp: {:+.2} dB\nBands: {} ({} enabled)\n\n#  On  Type  Frequency     Gain      Q\n",
        peq.global_gain,
        peq.filters.len(),
        peq.filters.iter().filter(|filter| filter.enabled).count()
    ));
    for filter in &peq.filters {
        output.push_str(&format!(
            "{:<2} {:<3} {:<5} {:>7} Hz  {:+6.2} dB  {:>5.2}\n",
            filter.index + 1,
            if filter.enabled { "yes" } else { "no" },
            autoeq_token(filter.filter_type),
            filter.freq,
            filter.gain,
            filter.q
        ));
    }
    for warning in warnings {
        eprintln!("warning: {warning}");
    }
    Ok(output)
}

fn normalize(path: &str, device_id: Option<&str>) -> Result<String, String> {
    let (mut peq, _, mut warnings) = read_peq(path)?;
    warnings.extend(
        peq.clamp_to_capabilities(device_id.map_or(Ok(&DESKTOP_DAC_CAPS), capabilities_for)?),
    );
    for warning in warnings {
        eprintln!("warning: {warning}");
    }
    Ok(peq_to_autoeq(&peq))
}

fn parse_usb_id(id: &str) -> Result<(u16, u16), String> {
    let (vendor, product) = id
        .split_once(':')
        .ok_or_else(|| format!("invalid USB ID {id}; expected VID:PID"))?;
    Ok((
        u16::from_str_radix(vendor, 16)
            .map_err(|_| format!("invalid hexadecimal vendor ID: {vendor}"))?,
        u16::from_str_radix(product, 16)
            .map_err(|_| format!("invalid hexadecimal product ID: {product}"))?,
    ))
}

fn capabilities_for(id: &str) -> Result<&'static DeviceCapabilities, String> {
    let (vendor, product) = parse_usb_id(id)?;
    get_supported_device(vendor, product)
        .map(|device| &device.caps)
        .ok_or_else(|| format!("unsupported USB device {id}"))
}

fn response(path: &str, sample_rate: f64) -> Result<String, String> {
    if !(40_000.0..=768_000.0).contains(&sample_rate) || !sample_rate.is_finite() {
        return Err("sample rate must be between 40000 and 768000 Hz".into());
    }
    let (peq, _, warnings) = read_peq(path)?;
    for warning in warnings {
        eprintln!("warning: {warning}");
    }
    let frequencies: Vec<f32> = (0..=200)
        .map(|index| 20.0_f32 * 1000.0_f32.powf(index as f32 / 200.0))
        .collect();
    let mut values = vec![peq.global_gain as f32; frequencies.len()];
    for filter in peq.filters.iter().filter(|filter| filter.enabled) {
        accumulate_response_values(
            filter.filter_type,
            filter.freq as f64,
            filter.gain,
            filter.q,
            sample_rate,
            &frequencies,
            &mut values,
        );
    }
    let mut output = String::from("frequency_hz,response_db\n");
    for (frequency, value) in frequencies.iter().zip(values) {
        output.push_str(&format!("{frequency:.2},{value:.4}\n"));
    }
    Ok(output)
}

#[allow(clippy::too_many_arguments)]
fn autoeq(
    measurement: &str,
    target: &str,
    bands: usize,
    steps: usize,
    smooth: &str,
    sample_rate: f32,
    device: Option<&str>,
) -> Result<String, String> {
    if measurement == "-" && target == "-" {
        return Err("measurement and target cannot both use stdin".into());
    }
    let measurement = parse_curve_text(&read_text(measurement)?)?;
    let target = parse_curve_text(&read_text(target)?)?;
    let mut peq = run_autoeq(&measurement, &target, bands, steps, smooth, sample_rate)?;
    if let Some(device) = device {
        for warning in peq.clamp_to_capabilities(capabilities_for(device)?) {
            eprintln!("warning: {warning}");
        }
    }
    Ok(peq_to_autoeq(&peq))
}

fn execute_profile(action: ProfileAction) -> Result<String, String> {
    let store = ProfileStore::default_location()?;
    match action {
        ProfileAction::List => {
            let mut output = String::from("name,modified\n");
            for profile in store.list()? {
                output.push_str(&format!(
                    "{},{}\n",
                    profile.name,
                    profile
                        .modified
                        .map_or_else(String::new, |value| value.to_string())
                ));
            }
            Ok(output)
        }
        ProfileAction::Show(name) => Ok(peq_to_autoeq(&store.load(&name)?.data)),
        ProfileAction::Save { name, file, yes } => {
            if store.exists(&name)? && !yes {
                return Err("profile exists; pass --yes to overwrite".into());
            }
            let (peq, _, warnings) = read_peq(&file)?;
            for warning in warnings {
                eprintln!("warning: {warning}");
            }
            store.save(&name, &peq)?;
            Ok(String::new())
        }
        ProfileAction::Delete { name, .. } => {
            store.delete(&name)?;
            Ok(String::new())
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios", target_arch = "wasm32")))]
struct HidIo(hidapi::HidDevice);

#[cfg(not(any(target_os = "android", target_os = "ios", target_arch = "wasm32")))]
impl DeviceIo for HidIo {
    fn write(&mut self, data: &[u8]) -> Result<(), String> {
        self.0
            .write(data)
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    fn read(&mut self, timeout_ms: i32) -> Result<Vec<u8>, String> {
        let mut data = [0; 256];
        let length = self
            .0
            .read_timeout(&mut data, timeout_ms)
            .map_err(|error| error.to_string())?;
        Ok(data[..length].to_vec())
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios", target_arch = "wasm32")))]
struct FoundDevice {
    path: std::ffi::CString,
    display_path: String,
    vendor: u16,
    product: u16,
    name: &'static str,
}

#[cfg(not(any(target_os = "android", target_os = "ios", target_arch = "wasm32")))]
fn found_devices(api: &hidapi::HidApi) -> Vec<FoundDevice> {
    api.device_list()
        .filter_map(|device| {
            let profile = get_supported_device(device.vendor_id(), device.product_id())?;
            Some(FoundDevice {
                path: device.path().to_owned(),
                display_path: device.path().to_string_lossy().into_owned(),
                vendor: device.vendor_id(),
                product: device.product_id(),
                name: profile.name,
            })
        })
        .collect()
}

#[cfg(not(any(target_os = "android", target_os = "ios", target_arch = "wasm32")))]
fn select_device<'a>(
    devices: &'a [FoundDevice],
    selector: Option<&str>,
) -> Result<&'a FoundDevice, String> {
    let matches: Vec<_> = match selector {
        None => devices.iter().collect(),
        Some(selector) if selector.contains(':') => {
            let (vendor, product) = parse_usb_id(selector)?;
            devices
                .iter()
                .filter(|device| device.vendor == vendor && device.product == product)
                .collect()
        }
        Some(path) => devices
            .iter()
            .filter(|device| device.display_path == path)
            .collect(),
    };
    match matches.as_slice() {
        [device] => Ok(device),
        [] => Err("no matching supported HID device".into()),
        _ => Err("multiple supported devices match; pass --device PATH".into()),
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios", target_arch = "wasm32")))]
fn open_session<T>(
    selector: Option<&str>,
    operation: impl FnOnce(&mut DeviceSession<'_>) -> Result<T, String>,
) -> Result<T, String> {
    let api = hidapi::HidApi::new().map_err(|error| error.to_string())?;
    let devices = found_devices(&api);
    let selected = select_device(&devices, selector)?;
    let profile = get_supported_device(selected.vendor, selected.product).ok_or_else(|| {
        format!(
            "No profile registered for {:04x}:{:04x}",
            selected.vendor, selected.product
        )
    })?;
    eprintln!("device: {}", selected.name);
    let mut io = HidIo(api.open_path(&selected.path).map_err(|error| {
        let message = format!("failed to open {}: {error}", selected.display_path);
        if message.to_lowercase().contains("permission denied") {
            format!("{message}; install Glacier EQ's udev rules, reload udev, and replug the DAC")
        } else {
            message
        }
    })?);
    let mut progress = |message: &str, percentage: f32| eprintln!("{percentage:>3.0}% {message}");
    operation(&mut DeviceSession::with_progress(
        &mut io,
        profile,
        &mut progress,
    ))
}

#[cfg(not(any(target_os = "android", target_os = "ios", target_arch = "wasm32")))]
fn execute_hardware(action: HardwareAction, selector: Option<&str>) -> Result<String, String> {
    if action == HardwareAction::List {
        let api = hidapi::HidApi::new().map_err(|error| error.to_string())?;
        let mut output = String::from("path,usb_id,device\n");
        for device in found_devices(&api) {
            output.push_str(&format!(
                "{},{:04x}:{:04x},{}\n",
                device.display_path, device.vendor, device.product, device.name
            ));
        }
        return Ok(output);
    }
    open_session(selector, |session| match action {
        HardwareAction::Pull => session.pull().map(|peq| peq_to_autoeq(&peq)),
        HardwareAction::Push(file) => {
            let (peq, _, warnings) = read_peq(&file)?;
            for warning in warnings {
                eprintln!("warning: {warning}");
            }
            session.persistent_push(peq).map(|_| String::new())
        }
        HardwareAction::Apply(file) => {
            let (peq, _, warnings) = read_peq(&file)?;
            for warning in warnings {
                eprintln!("warning: {warning}");
            }
            session.apply_ram(peq).map(|_| String::new())
        }
        HardwareAction::List => unreachable!(),
    })
}

#[cfg(not(any(target_os = "android", target_os = "ios", target_arch = "wasm32")))]
fn execute_controls(action: ControlAction, selector: Option<&str>) -> Result<String, String> {
    open_session(selector, |session| match action {
        ControlAction::Status => {
            let status = session.utility_status()?;
            Ok(format!(
                "supported,filter_mode,amp_mode,gain_mode,mic_db,balance\n{},{},{},{},{},{}\n",
                status.supported,
                status.filter_mode,
                if status.amp_mode_class_ab { "ab" } else { "a" },
                if status.high_gain_mode { "high" } else { "low" },
                status.mic_volume_db,
                status.channel_balance
            ))
        }
        ControlAction::Filter(mode) => session.set_filter_mode(&mode).map(|_| String::new()),
        ControlAction::Amp(ab) => session.set_amp_mode(ab).map(|_| String::new()),
        ControlAction::Gain(high) => session.set_gain_mode(high).map(|_| String::new()),
        ControlAction::Balance(value) => session.set_balance(value).map(|_| String::new()),
        ControlAction::Mic(value) => session.set_mic_volume(value).map(|_| String::new()),
        ControlAction::Reset(kind) if kind == "eq" => session.reset_eq().map(|_| String::new()),
        ControlAction::Reset(kind) if kind == "controls" => {
            session.reset_controls().map(|_| String::new())
        }
        ControlAction::Reset(_) => session.factory_reset().map(|_| String::new()),
    })
}

#[cfg(any(target_os = "android", target_os = "ios", target_arch = "wasm32"))]
fn execute_hardware(_: HardwareAction, _: Option<&str>) -> Result<String, String> {
    Err("direct HID is available only on desktop".into())
}
#[cfg(any(target_os = "android", target_os = "ios", target_arch = "wasm32"))]
fn execute_controls(_: ControlAction, _: Option<&str>) -> Result<String, String> {
    Err("direct HID is available only on desktop".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mutation_confirmation_is_pure_and_precedes_hid() {
        let command = parse(vec!["hardware".into(), "push".into(), "eq.txt".into()]).unwrap();
        assert_eq!(
            require_confirmation(&command).unwrap_err(),
            "mutation requires explicit --yes"
        );
        let confirmed = parse(vec![
            "hardware".into(),
            "push".into(),
            "eq.txt".into(),
            "--yes".into(),
        ])
        .unwrap();
        assert!(require_confirmation(&confirmed).is_ok());
    }

    #[test]
    fn parses_autoeq_options_without_clap() {
        let command = parse(vec![
            "autoeq".into(),
            "m.csv".into(),
            "t.csv".into(),
            "--bands".into(),
            "8".into(),
            "--smooth".into(),
            "ie".into(),
        ])
        .unwrap();
        assert!(matches!(
            command,
            Command::AutoEq {
                bands: 8,
                smooth,
                ..
            } if smooth == "ie"
        ));
    }

    #[test]
    fn profile_delete_always_needs_confirmation() {
        let command = parse(vec!["profile".into(), "delete".into(), "Daily".into()]).unwrap();
        assert!(require_confirmation(&command).is_err());
    }

    #[test]
    fn response_rejects_impossible_sample_rate() {
        assert_eq!(
            response("unused", 1.0).unwrap_err(),
            "sample rate must be between 40000 and 768000 Hz"
        );
    }
}
