import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type FilterType = "Peak" | "LowShelf" | "HighShelf" | "HighPass" | "LowPass";

interface Filter {
  index: number;
  enabled: boolean;
  filter_type: FilterType;
  freq: number;
  gain: number;
  q: number;
}

interface PEQData {
  filters: Filter[];
  global_gain: number;
}

interface DeviceInfo {
  vendor_id: number;
  product_id: number;
  path: string;
  manufacturer: string | null;
  product_string: string | null;
  profile_name: string | null;
}

interface Profile {
  name: string;
  data: PEQData;
  modified: string | null;
}

const FILTER_TYPES: FilterType[] = ["Peak", "HighShelf", "LowShelf", "HighPass", "LowPass"];
const TYPE_LABELS: Record<FilterType, string> = {
  Peak: "PK",
  HighShelf: "HS",
  LowShelf: "LS",
  HighPass: "HP",
  LowPass: "LP",
};

const DEFAULT_PROFILE_NAME = "Default EQ";
const SUPPORTED_DACS = [
  { name: "EPZ TP35 Pro", vid: "3302", pid: "43E6", status: "Tested" },
  { name: "Moondrop Dawn Pro", vid: "2FC6", pid: "DF30", status: "Untested" },
  { name: "Truthear KEYX", vid: "0D8C", pid: "0210", status: "Untested" },
];

function buildDefaultState(): PEQData {
  const freqs = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  return {
    global_gain: 0,
    filters: freqs.map((freq, index) => ({
      index,
      enabled: true,
      filter_type: "Peak",
      freq,
      gain: 0,
      q: 1,
    })),
  };
}

function normalizeFilterType(raw: unknown): FilterType {
  switch (String(raw ?? "").replace(/\s+/g, "").toLowerCase()) {
    case "lsq":
    case "lsc":
    case "ls":
    case "lowshelf":
      return "LowShelf";
    case "hsq":
    case "hsc":
    case "hs":
    case "highshelf":
      return "HighShelf";
    case "hp":
    case "hpf":
    case "highpass":
      return "HighPass";
    case "lp":
    case "lpf":
    case "lowpass":
      return "LowPass";
    case "pk":
    case "peak":
    default:
      return "Peak";
  }
}

function numberOr(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function normalizePeq(raw: any, options: { enableLoadedFilters?: boolean } = {}): PEQData {
  const defaults = buildDefaultState();
  const inputFilters = Array.isArray(raw?.filters) ? raw.filters : [];
  const filters = defaults.filters.map((fallback, index) => {
    const hasInput = inputFilters[index] !== undefined;
    const input = inputFilters[index] ?? {};
    return {
      index,
      // Frost-Tune enables every filter loaded from AutoEQ/profile text, then
      // pads missing device bands as inactive flat filters.
      enabled: hasInput
        ? options.enableLoadedFilters || (typeof input.enabled === "boolean" ? input.enabled : fallback.enabled)
        : false,
      filter_type: normalizeFilterType(input.filter_type ?? input.type ?? fallback.filter_type),
      freq: Math.round(numberOr(input.freq, fallback.freq)),
      gain: numberOr(input.gain, fallback.gain),
      q: numberOr(input.q, fallback.q),
    };
  });

  return {
    filters,
    global_gain: Math.round(numberOr(raw?.global_gain ?? raw?.globalGain, defaults.global_gain)),
  };
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const logMin = Math.log10(20);
const logMax = Math.log10(20000);

function freqToX(freq: number, w: number): number {
  return ((Math.log10(clamp(freq, 20, 20000)) - logMin) / (logMax - logMin)) * w;
}

function xToFreq(x: number, w: number): number {
  return 10 ** (logMin + (x / w) * (logMax - logMin));
}

function dbToY(db: number, h: number): number {
  return (1 - (clamp(db, -18, 18) + 18) / 36) * h;
}

function formatFreq(f: number): string {
  return f >= 1000 ? `${f / 1000}k` : `${f}`;
}

function bandResponse(freq: number, filter: Filter): number {
  if (!filter.enabled || filter.freq <= 0) return 0;
  const octaves = Math.log2(freq / filter.freq);
  const width = Math.max(0.18, 1 / Math.max(0.2, filter.q));
  const bell = Math.exp(-0.5 * (octaves / width) ** 2);

  switch (filter.filter_type) {
    case "LowShelf":
      return filter.gain / (1 + (freq / filter.freq) ** (Math.max(0.4, filter.q) * 2));
    case "HighShelf":
      return filter.gain / (1 + (filter.freq / freq) ** (Math.max(0.4, filter.q) * 2));
    case "HighPass":
      return -18 / (1 + (freq / filter.freq) ** (Math.max(0.5, filter.q) * 3));
    case "LowPass":
      return -18 / (1 + (filter.freq / freq) ** (Math.max(0.5, filter.q) * 3));
    default:
      return filter.gain * bell;
  }
}

function EqGraph({ peq }: { peq: PEQData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    if (w < 2 || h < 2) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#1f2335";
    ctx.fillRect(0, 0, w, h);

    const freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    const dbs = [-15, -10, -5, 0, 5, 10, 15];
    const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-mono") || "ui-monospace";

    ctx.strokeStyle = "rgba(128, 128, 128, 0.20)";
    ctx.lineWidth = 1;
    ctx.font = `12px ${mono}`;
    ctx.fillStyle = "#a9b1d6";

    for (const f of freqs) {
      const x = freqToX(f, w);
      ctx.beginPath();
      ctx.moveTo(x, 18);
      ctx.lineTo(x, h - 18);
      ctx.stroke();
      ctx.fillText(formatFreq(f), x + 4, h - 4);
    }

    for (const db of dbs) {
      const y = dbToY(db, h);
      ctx.beginPath();
      ctx.moveTo(14, y);
      ctx.lineTo(w - 14, y);
      ctx.stroke();
      ctx.fillText(`${db > 0 ? "+" : ""}${db}dB`, 18, y - 4);
    }

    const points: number[] = [];
    for (let px = 0; px < w; px++) {
      const f = xToFreq(px, w);
      const total = peq.global_gain + peq.filters.reduce((sum, band) => sum + bandResponse(f, band), 0);
      points.push(Number.isFinite(total) ? total : 0);
    }

    const drawResponse = (values: number[], color: string, width = 1) => {
      ctx.beginPath();
      values.forEach((db, x) => {
        const y = dbToY(db, h);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };

    for (const band of peq.filters.filter((f) => f.enabled)) {
      const bandPoints = Array.from({ length: w }, (_, px) => bandResponse(xToFreq(px, w), band));
      drawResponse(bandPoints, "rgba(125, 207, 255, 0.22)", 1);
    }

    const zero = dbToY(0, h);
    ctx.beginPath();
    ctx.moveTo(0, zero);
    points.forEach((db, x) => ctx.lineTo(x, dbToY(db, h)));
    ctx.lineTo(w, zero);
    ctx.closePath();
    ctx.fillStyle = "rgba(125, 207, 255, 0.15)";
    ctx.fill();

    drawResponse(points, "#7dcfff", 3);
  }, [peq]);

  useEffect(() => {
    let raf = requestAnimationFrame(draw);
    const canvas = canvasRef.current;
    if (!canvas) return () => cancelAnimationFrame(raf);

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    });
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [draw]);

  return <canvas className="eq-canvas" ref={canvasRef} />;
}

function Icon({ children }: { children: string }) {
  return <span className="material-icon">{children}</span>;
}

function ToolbarButton({ children, primary, onClick, disabled }: { children: string; primary?: boolean; onClick?: () => void; disabled?: boolean }) {
  return <button className={primary ? "btn filled" : "btn tonal"} onClick={onClick} disabled={disabled}>{children}</button>;
}

function Header({ connected, isBusy, profile, deviceName, dirty, onPull, onPush, onDisconnect }: {
  connected: boolean;
  isBusy: boolean;
  profile: string;
  deviceName: string;
  dirty: boolean;
  onPull: () => void;
  onPush: () => void;
  onDisconnect: () => void;
}) {
  if (!connected) {
    return (
      <header className="app-header selection-header">
        <div className="title-stack">
          <div className="title-line">
            <h1>Frost-Tune</h1>
            <span className="sync-dot offline">● Offline</span>
          </div>
          <div className="device-name">Select a supported DAC to begin</div>
        </div>
      </header>
    );
  }

  return (
    <header className="app-header">
      <div className="title-stack">
        <div className="title-line">
          <h1>Frost-Tune</h1>
          <span className="dash">—</span>
          <strong>{profile}</strong>
          {dirty && <span className="unsaved">UNSAVED</span>}
          <span className="sync-dot ok">● {isBusy ? "Working…" : "Synced"}</span>
        </div>
        <div className="device-name">{deviceName}</div>
      </div>
      <div className="toolbar">
        <ToolbarButton onClick={onPull} disabled={isBusy}>Pull</ToolbarButton>
        <ToolbarButton primary onClick={onPush} disabled={isBusy}>Push</ToolbarButton>
        <ToolbarButton onClick={onDisconnect} disabled={isBusy}>Disconnect</ToolbarButton>
      </div>
    </header>
  );
}

function DeviceChooser({ devices, onScan, onConnect, selectedDevice, setSelectedDevice, status, isBusy }: {
  devices: DeviceInfo[];
  onScan: () => void;
  onConnect: () => void;
  selectedDevice: string;
  setSelectedDevice: (path: string) => void;
  status: string;
  isBusy: boolean;
}) {
  return (
    <main className="disconnected-screen">
      <section className="device-card">
        <div className="device-card-head">
          <div>
            <h2>Available Devices</h2>
            <p>Only supported DACs from Frost-Tune's registry are shown.</p>
          </div>
          <ToolbarButton onClick={onScan} disabled={isBusy}>{isBusy ? "Scanning…" : "Scan"}</ToolbarButton>
        </div>

        {devices.length === 0 ? (
          <div className="empty-device-state">
            <strong>No supported DAC found</strong>
            <span>Plug in one of the supported devices below, then scan again.</span>
          </div>
        ) : (
          <div className="device-list">
            {devices.map((d) => {
              const name = d.profile_name || d.product_string || d.manufacturer || "Supported DAC";
              const selected = selectedDevice === d.path;
              return (
                <button key={d.path} className={selected ? "device-row selected" : "device-row"} onClick={() => setSelectedDevice(d.path)} onDoubleClick={onConnect}>
                  <span className="device-row-title">{name}</span>
                  <span className="device-row-meta">VID: {d.vendor_id.toString(16).padStart(4, "0").toUpperCase()} &nbsp; PID: {d.product_id.toString(16).padStart(4, "0").toUpperCase()}</span>
                  <small>{d.product_string || d.manufacturer || "Walkplay Family DAC"}</small>
                </button>
              );
            })}
          </div>
        )}

        <div className="supported-list">
          <span>SUPPORTED</span>
          {SUPPORTED_DACS.map((dac) => (
            <div key={dac.name}><strong>{dac.name}</strong><small>{dac.vid}:{dac.pid} · {dac.status}</small></div>
          ))}
        </div>

        <div className="device-actions">
          <ToolbarButton primary onClick={onConnect} disabled={!selectedDevice || isBusy}>Connect</ToolbarButton>
        </div>
        <span className="status-text">{status}</span>
      </section>
    </main>
  );
}

function Preamp({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return (
    <section className="preamp-card">
      <strong>PREAMP: {safeValue} dB</strong>
      <input type="range" min={-16} max={6} step={1} value={safeValue} onChange={(e) => onChange(+e.target.value)} />
    </section>
  );
}

function FilterTypeButtons({ filter, onChange }: { filter: Filter; onChange: (f: Filter) => void }) {
  return (
    <div className="type-buttons">
      {FILTER_TYPES.map((type) => (
        <button key={type} className={filter.filter_type === type ? "selected" : ""} onClick={() => onChange({ ...filter, filter_type: type })}>
          {TYPE_LABELS[type]}
        </button>
      ))}
    </div>
  );
}

function BandRow({ filter, onChange }: { filter: Filter; onChange: (f: Filter) => void }) {
  const active = filter.enabled;
  return (
    <div className={`band-row ${active ? "" : "muted"}`}>
      <button className="band-index" onClick={() => onChange({ ...filter, enabled: !active })}>{filter.index + 1}</button>
      <FilterTypeButtons filter={filter} onChange={onChange} />
      <input className="num-input freq" value={filter.freq} onChange={(e) => onChange({ ...filter, freq: +e.target.value || 20 })} />
      <div className="gain-cell">
        <input type="range" min={-10} max={10} step={0.01} value={filter.gain} onChange={(e) => onChange({ ...filter, gain: +e.target.value })} />
        <input className="num-input gain" value={filter.gain.toFixed(2)} onChange={(e) => onChange({ ...filter, gain: +e.target.value || 0 })} />
      </div>
      <input className="num-input q" value={filter.q.toFixed(2)} onChange={(e) => onChange({ ...filter, q: +e.target.value || 0.1 })} />
    </div>
  );
}

function Bands({ peq, onFilterChange }: { peq: PEQData; onFilterChange: (i: number, f: Filter) => void }) {
  const columns = [peq.filters.slice(0, 5), peq.filters.slice(5)];
  return (
    <section className="bands-grid">
      {columns.map((bands, col) => (
        <div className="bands-card" key={col}>
          <div className="bands-header">
            <span>BAND</span><span>TYPE</span><span>FREQ (Hz)</span><span>GAIN (dB)</span><span>Q</span>
          </div>
          {bands.map((filter) => <BandRow key={filter.index} filter={filter} onChange={(f) => onFilterChange(filter.index, f)} />)}
        </div>
      ))}
    </section>
  );
}

function ToolsPanel({
  profiles,
  selectedPreset,
  profileSearch,
  setProfileSearch,
  newProfileName,
  setNewProfileName,
  onSelectProfile,
  onReloadProfiles,
  onOpenProfilesDir,
  onReset,
  onSave,
  onDelete,
}: {
  profiles: Profile[];
  selectedPreset: string;
  profileSearch: string;
  setProfileSearch: (value: string) => void;
  newProfileName: string;
  setNewProfileName: (value: string) => void;
  onSelectProfile: (profile: Profile) => void;
  onReloadProfiles: () => void;
  onOpenProfilesDir: () => void;
  onReset: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const [tab, setTab] = useState<"Preset" | "Import" | "Settings">("Preset");
  const query = profileSearch.trim().toLowerCase();
  const filteredProfiles = profiles.filter((profile) => !query || profile.name.toLowerCase().includes(query));
  const selectedProfile = profiles.find((profile) => profile.name === selectedPreset);
  const canDelete = selectedPreset !== DEFAULT_PROFILE_NAME && profiles.some((profile) => profile.name === selectedPreset);

  return (
    <aside className="right-rail">
      <section className="tools-card">
        <nav className="tabs">
          {(["Preset", "Import", "Settings"] as const).map((name) => <button key={name} className={tab === name ? "active" : ""} onClick={() => setTab(name)}>{name}</button>)}
        </nav>
        {tab === "Preset" && <>
          <div className="search-row">
            <input placeholder="Search profiles…" value={profileSearch} onChange={(e) => setProfileSearch(e.target.value)} />
            <button title="Reload profiles" onClick={onReloadProfiles}><Icon>refresh</Icon></button>
            <button title="Open profiles folder" onClick={onOpenProfilesDir}><Icon>folder</Icon></button>
          </div>
          <div className="preset-list">
            {filteredProfiles.length === 0 ? <div className="empty-profiles">No profiles found</div> : filteredProfiles.map((profile) => (
              <button key={profile.name} className={selectedPreset === profile.name ? "selected" : ""} onClick={() => onSelectProfile(profile)}>{profile.name}</button>
            ))}
          </div>
          <small className="modified">{selectedProfile?.modified ? `Modified: ${selectedProfile.modified}` : "Profiles: Frost-Tune data folder"}</small>
          <label className="check-line"><input type="checkbox" defaultChecked /> Snap to ISO frequencies</label>
          <input className="new-name" placeholder="New Name…" value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} />
        </>}
        {tab === "Import" && <div className="import-grid"><button>Import File</button><button>Paste</button><button>Export File</button><button>Copy</button></div>}
        {tab === "Settings" && <div className="settings-list"><label><input type="checkbox" defaultChecked /> Auto-pull EQ from device on connect</label><label><input type="checkbox" /> Skip push verification</label></div>}
        <div className="action-row"><button disabled>Undo</button><button disabled>Redo</button></div>
        <div className="action-row"><button onClick={onReset}>Reset</button><button className="save" onClick={onSave}>Save</button><button className="danger" disabled={!canDelete} onClick={onDelete}>Delete</button></div>
      </section>
      <section className="diag-card">
        <div className="diag-head"><strong>DIAGNOSTICS</strong><Icon>warning</Icon><button>Copy</button><button>Clear</button><button>Export</button></div>
        <div className="diag-summary">E:0&nbsp;&nbsp;W:0&nbsp;&nbsp;I:140</div>
        <div className="log-box">
          {["Status set: Device matches profile: TE Nova Diamond B", "Pull successful", "Reading from device...", "Connected to EPZ TP35 Pro"].map((line, i) => <p key={line}><span>18:03:{16 - i}.038</span> <span>[UI]</span> {line}</p>)}
        </div>
      </section>
    </aside>
  );
}

function App() {
  const [peq, setPeq] = useState<PEQData>(buildDefaultState);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [connected, setConnected] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedPreset, setSelectedPreset] = useState(DEFAULT_PROFILE_NAME);
  const [profileSearch, setProfileSearch] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [dirty, setDirty] = useState(false);
  const selectedPresetRef = useRef(selectedPreset);

  useEffect(() => {
    selectedPresetRef.current = selectedPreset;
  }, [selectedPreset]);

  const deviceName = useMemo(() => {
    const selected = devices.find((d) => d.path === selectedDevice);
    return selected?.profile_name || selected?.product_string || "EPZ TP35 Pro";
  }, [devices, selectedDevice]);

  const applyProfile = useCallback((profile: Profile) => {
    const data = normalizePeq(profile.data, { enableLoadedFilters: true });
    selectedPresetRef.current = profile.name;
    setPeq(data);
    setSelectedPreset(profile.name);
    setNewProfileName(profile.name);
    setDirty(false);
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      const loaded = await invoke<Profile[]>("list_profiles");
      setProfiles(loaded);

      const current = selectedPresetRef.current;
      const selected = loaded.find((profile) => profile.name === current) ?? loaded[0];
      if (selected) {
        applyProfile(selected);
      } else if (current === DEFAULT_PROFILE_NAME) {
        setPeq(buildDefaultState());
      }
    } catch (e) {
      setStatus(`Profile load failed: ${e}`);
    }
  }, [applyProfile]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const scanDevices = useCallback(async () => {
    setIsBusy(true);
    setStatus("Scanning for devices...");
    try {
      const list = await invoke<DeviceInfo[]>("list_devices");
      setDevices(list);
      if (list[0]) setSelectedDevice(list[0].path);
      setStatus(list.length ? `Found ${list.length} device(s)` : "No compatible DACs found");
    } catch (e) {
      setStatus(`Scan failed: ${e}`);
    } finally {
      setIsBusy(false);
    }
  }, []);

  useEffect(() => {
    scanDevices();
  }, [scanDevices]);

  const connectDevice = useCallback(async () => {
    if (!selectedDevice) return;
    setIsBusy(true);
    try {
      await invoke("connect_device", { path: selectedDevice });
      setConnected(true);
      setStatus("Ready");
    } catch (e) {
      setStatus(`Connection failed: ${e}`);
    } finally {
      setIsBusy(false);
    }
  }, [selectedDevice]);

  const pullEq = useCallback(async () => {
    setIsBusy(true);
    try {
      const data = await invoke<PEQData>("get_eq_state");
      setPeq(normalizePeq(data));
      selectedPresetRef.current = "Pulled from device";
      setSelectedPreset("Pulled from device");
      setDirty(false);
      setStatus("Pull successful");
    } catch (e) {
      setStatus(`Pull failed: ${e}`);
    } finally {
      setIsBusy(false);
    }
  }, []);

  const pushEq = useCallback(async () => {
    setIsBusy(true);
    try {
      await invoke("set_eq_state", { peq });
      setDirty(false);
      setStatus("Push successful");
    } catch (e) {
      setStatus(`Push failed: ${e}`);
    } finally {
      setIsBusy(false);
    }
  }, [peq]);

  const disconnectDevice = useCallback(async () => {
    setIsBusy(true);
    try {
      await invoke("disconnect_device");
      setConnected(false);
      setStatus("Disconnected");
    } catch (e) {
      setStatus(`Disconnect failed: ${e}`);
    } finally {
      setIsBusy(false);
    }
  }, []);

  const saveProfile = useCallback(async () => {
    const name = newProfileName.trim() || selectedPreset;
    if (!name || name === DEFAULT_PROFILE_NAME || name === "Pulled from device") {
      setStatus("Enter a profile name before saving.");
      return;
    }
    try {
      await invoke("save_profile", { name, peq });
      selectedPresetRef.current = name;
      setSelectedPreset(name);
      setNewProfileName("");
      setDirty(false);
      await loadProfiles();
      setStatus("Profile saved");
    } catch (e) {
      setStatus(`Save failed: ${e}`);
    }
  }, [loadProfiles, newProfileName, peq, selectedPreset]);

  const deleteSelectedProfile = useCallback(async () => {
    if (selectedPreset === DEFAULT_PROFILE_NAME) return;
    try {
      await invoke("delete_profile", { name: selectedPreset });
      setSelectedPreset(DEFAULT_PROFILE_NAME);
      selectedPresetRef.current = DEFAULT_PROFILE_NAME;
      setPeq(buildDefaultState());
      await loadProfiles();
      setStatus("Profile deleted");
    } catch (e) {
      setStatus(`Delete failed: ${e}`);
    }
  }, [loadProfiles, selectedPreset]);

  const openProfilesDir = useCallback(async () => {
    try {
      await invoke("open_profiles_dir");
    } catch (e) {
      setStatus(`Open profiles folder failed: ${e}`);
    }
  }, []);

  const updateFilter = (index: number, updated: Filter) => {
    setDirty(true);
    setPeq((prev) => {
      const filters = [...prev.filters];
      filters[index] = updated;
      return { ...prev, filters };
    });
  };

  const reset = () => {
    selectedPresetRef.current = DEFAULT_PROFILE_NAME;
    setPeq(buildDefaultState());
    setSelectedPreset(DEFAULT_PROFILE_NAME);
    setDirty(true);
  };

  return (
    <div id="app">
      <Header connected={connected} isBusy={isBusy} profile={selectedPreset} deviceName={deviceName} dirty={dirty} onPull={pullEq} onPush={pushEq} onDisconnect={disconnectDevice} />
      {connected && status !== "Ready" && <div className="status-banner"><Icon>info</Icon>{status}<button onClick={() => setStatus("Ready")}><Icon>close</Icon></button></div>}
      {!connected ? <DeviceChooser devices={devices} onScan={scanDevices} onConnect={connectDevice} selectedDevice={selectedDevice} setSelectedDevice={setSelectedDevice} status={status} isBusy={isBusy} /> : (
        <main className="workspace">
          <section className="left-pane">
            <section className="graph-card"><EqGraph peq={peq} /></section>
            <Preamp value={peq.global_gain} onChange={(global_gain) => { setDirty(true); setPeq((p) => ({ ...p, global_gain })); }} />
            <Bands peq={peq} onFilterChange={updateFilter} />
          </section>
          <ToolsPanel
            profiles={profiles}
            selectedPreset={selectedPreset}
            profileSearch={profileSearch}
            setProfileSearch={setProfileSearch}
            newProfileName={newProfileName}
            setNewProfileName={setNewProfileName}
            onSelectProfile={applyProfile}
            onReloadProfiles={loadProfiles}
            onOpenProfilesDir={openProfilesDir}
            onReset={reset}
            onSave={saveProfile}
            onDelete={deleteSelectedProfile}
          />
        </main>
      )}
    </div>
  );
}

export default App;
