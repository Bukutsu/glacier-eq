import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

// ── Types ────────────────────────────────────────────────────────────────────

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
}

// ── Constants ────────────────────────────────────────────────────────────────

const FILTER_TYPES: FilterType[] = ["Peak", "HighShelf", "LowShelf", "HighPass", "LowPass"];
const NUM_BANDS = 10;

// ── Helpers ──────────────────────────────────────────────────────────────────

function freqToX(freq: number, w: number): number {
  const minLog = Math.log(20);
  const maxLog = Math.log(20000);
  return ((Math.log(freq) - minLog) / (maxLog - minLog)) * w;
}

function xToFreq(x: number, w: number): number {
  const minLog = Math.log(20);
  const maxLog = Math.log(20000);
  return Math.exp(minLog + (x / w) * (maxLog - minLog));
}

function formatFreq(f: number): string {
  return f >= 1000 ? `${(f / 1000).toFixed(0)}k` : `${f}`;
}

function computePeakGain(freq: number, centerFreq: number, gainDb: number, q: number): number {
  if (q <= 0) return 0;
  const ratio = freq / centerFreq;
  const invRatio = centerFreq / freq;
  const numerator = 1 + ratio / q;
  const denominator = 1 + invRatio / q;
  const h = numerator / denominator;
  const g = Math.pow(10, gainDb / 20);
  return 20 * Math.log10((g * h) / (1 + h * (g - 1)));
}

function buildDefaultState(): PEQData {
  const filters: Filter[] = Array.from({ length: NUM_BANDS }, (_, i) => ({
    index: i,
    enabled: i === 4,
    filter_type: "Peak" as FilterType,
    freq: 1000,
    gain: 0,
    q: 1.0,
  }));
  return { filters, global_gain: 0 };
}

// ── Graph component ──────────────────────────────────────────────────────────

function EqGraph({ peq }: { peq: PEQData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#1a1d27";
    ctx.fillRect(0, 0, w, h);

    if (peq.filters.length === 0) return;

    // Grid lines
    ctx.strokeStyle = "#242838";
    ctx.lineWidth = 1;
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Frequency labels
    ctx.fillStyle = "#7f85a2";
    ctx.font = "11px Inter, sans-serif";
    const freqLabels = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    for (const f of freqLabels) {
      const x = freqToX(f, w);
      ctx.fillText(formatFreq(f), x, h - 6);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.strokeStyle = "#242838";
      ctx.stroke();
    }

    // Compute summed response
    const points: number[] = [];
    for (let px = 0; px < w; px++) {
      const freq = xToFreq(px, w);
      let sumGain = peq.global_gain;
      for (const filter of peq.filters) {
        if (!filter.enabled) continue;
        sumGain += computePeakGain(freq, filter.freq, filter.gain, filter.q);
      }
      points.push(sumGain);
    }

    const maxGain = Math.max(...points, 6);
    const minGain = Math.min(...points, -6);
    const range = Math.max(maxGain - minGain, 12);
    const midY = h / 2;
    const scale = (h * 0.85) / range;

    // Draw curve
    ctx.beginPath();
    ctx.strokeStyle = "#6c8cff";
    ctx.lineWidth = 2.5;
    for (let px = 0; px < points.length; px++) {
      const y = midY - (points[px] - (maxGain + minGain) / 2) * scale;
      px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
    }
    ctx.stroke();

    // Fill
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = "rgba(108, 140, 255, 0.08)";
    ctx.fill();
  }, [peq]);

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={280}
      style={{ width: "100%", height: "280px", borderRadius: "8px" }}
    />
  );
}

// ── Band row component ───────────────────────────────────────────────────────

function BandRow({
  filter,
  onChange,
}: {
  filter: Filter;
  onChange: (f: Filter) => void;
}) {
  return (
    <div className="band-row">
      <span className="index">{filter.index + 1}</span>

      <select
        value={filter.filter_type}
        onChange={(e) => onChange({ ...filter, filter_type: e.target.value as FilterType })}
      >
        {FILTER_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      <input
        type="range"
        min={-10}
        max={10}
        step={0.5}
        value={filter.gain}
        onChange={(e) => onChange({ ...filter, gain: +e.target.value })}
      />

      <span className="value">{filter.gain.toFixed(1)} dB</span>
      <span className="value">{filter.freq} Hz</span>
      <span className="value">Q {filter.q.toFixed(2)}</span>

      <span
        className={`toggle ${filter.enabled ? "" : "off"}`}
        onClick={() => onChange({ ...filter, enabled: !filter.enabled })}
      >
        {filter.enabled ? "🔊" : "🔇"}
      </span>
    </div>
  );
}

// ── Main app ─────────────────────────────────────────────────────────────────

function App() {
  const [peq, setPeq] = useState<PEQData>(buildDefaultState);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Disconnected — click Scan to find your DAC");

  // Load initial state from Tauri
  useEffect(() => {
    invoke<PEQData>("get_eq_state")
      .then((data) => setPeq(data))
      .catch(() => { /* default state used */ });
  }, []);

  const scanDevices = useCallback(async () => {
    setStatus("Scanning for devices...");
    try {
      const list = await invoke<DeviceInfo[]>("list_devices");
      setDevices(list);
      if (list.length === 0) {
        setStatus("No compatible DACs found");
      } else {
        setSelectedDevice(list[0].path);
        setStatus(`Found ${list.length} device(s)`);
      }
    } catch (e) {
      setStatus(`Scan failed: ${e}`);
    }
  }, []);

  const connectDevice = useCallback(async () => {
    if (!selectedDevice) return;
    setStatus(`Connecting...`);
    try {
      await invoke("connect_device", { path: selectedDevice });
      setConnected(true);
      setStatus("Connected");
    } catch (e) {
      setStatus(`Connection failed: ${e}`);
    }
  }, [selectedDevice]);

  const applyEq = useCallback(async () => {
    try {
      await invoke("set_eq_state", { peq });
      setStatus("EQ applied to device ✅");
    } catch (e) {
      setStatus(`Apply failed: ${e}`);
    }
  }, [peq]);

  const resetFlat = useCallback(() => {
    setPeq(buildDefaultState());
    setStatus("Reset to flat");
  }, []);

  const updateFilter = useCallback((index: number, updated: Filter) => {
    setPeq((prev) => {
      const filters = [...prev.filters];
      filters[index] = updated;
      return { ...prev, filters };
    });
  }, []);

  return (
    <div id="app">
      <header>
        <h1>Glacier EQ</h1>
        <div id="device-bar">
          <button onClick={scanDevices}>🔍 Scan</button>
          <select
            value={selectedDevice}
            onChange={(e) => setSelectedDevice(e.target.value)}
            disabled={devices.length === 0}
          >
            {devices.length === 0 && <option value="">No devices found</option>}
            {devices.map((d) => (
              <option key={d.path} value={d.path}>
                {d.product_string || `${d.vendor_id.toString(16)}:${d.product_id.toString(16)}`}
              </option>
            ))}
          </select>
          <button onClick={connectDevice} disabled={!selectedDevice || connected}>
            {connected ? "Connected" : "Connect"}
          </button>
        </div>
      </header>

      <main>
        <section id="graph-section">
          <EqGraph peq={peq} />
        </section>

        <section id="bands-section">
          {peq.filters.map((filter) => (
            <BandRow
              key={filter.index}
              filter={filter}
              onChange={(f) => updateFilter(filter.index, f)}
            />
          ))}
        </section>

        <section id="controls-section">
          <div className="control-row">
            <label>Global Gain</label>
            <div className="slider-group">
              <input
                type="range"
                min={-16}
                max={6}
                step={1}
                value={peq.global_gain}
                onChange={(e) =>
                  setPeq((prev) => ({ ...prev, global_gain: +e.target.value }))
                }
              />
              <span>{peq.global_gain} dB</span>
            </div>
          </div>
          <div className="control-row">
            <button id="flat-btn" onClick={resetFlat}>
              Reset to Flat
            </button>
            <button id="apply-btn" onClick={applyEq} disabled={!connected}>
              Apply to Device
            </button>
          </div>
        </section>
      </main>

      <footer>
        <span id="status">{status}</span>
      </footer>
    </div>
  );
}

export default App;
