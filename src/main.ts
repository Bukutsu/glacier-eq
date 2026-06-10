import { invoke } from "@tauri-apps/api/core";

// ── Types ────────────────────────────────────────────────────────────────────

interface Filter {
  index: number;
  enabled: boolean;
  filter_type: "Peak" | "LowShelf" | "HighShelf" | "HighPass" | "LowPass";
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

// ── State ────────────────────────────────────────────────────────────────────

let state: PEQData = {
  filters: [],
  global_gain: 0,
};

// ── DOM refs ─────────────────────────────────────────────────────────────────

const bandsContainer = document.getElementById("bands-container")!;
const eqGraph = document.getElementById("eq-graph") as HTMLCanvasElement;
const graphCtx = eqGraph.getContext("2d")!;
const globalGainSlider = document.getElementById("global-gain") as HTMLInputElement;
const globalGainValue = document.getElementById("global-gain-value")!;
const statusEl = document.getElementById("status")!;
const deviceSelect = document.getElementById("device-select") as HTMLSelectElement;
const scanBtn = document.getElementById("scan-btn") as HTMLButtonElement;
const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const applyBtn = document.getElementById("apply-btn") as HTMLButtonElement;
const flatBtn = document.getElementById("flat-btn") as HTMLButtonElement;

// ── Rendering ────────────────────────────────────────────────────────────────

function renderBands() {
  bandsContainer.innerHTML = "";
  for (const filter of state.filters) {
    const row = document.createElement("div");
    row.className = "band-row";

    const types = ["Peak", "HighShelf", "LowShelf", "HighPass", "LowPass"];

    row.innerHTML = `
      <span class="index">${filter.index + 1}</span>
      <select>
        ${types.map(t => `<option value="${t}" ${t === filter.filter_type ? "selected" : ""}>${t}</option>`).join("")}
      </select>
      <input type="range" min="-10" max="10" value="${filter.gain}" step="0.5" />
      <span class="value">${filter.gain.toFixed(1)} dB</span>
      <span class="value">${filter.freq} Hz</span>
      <span class="value">Q ${filter.q.toFixed(2)}</span>
      <span class="toggle ${filter.enabled ? "" : "off"}">
        ${filter.enabled ? "🔊" : "🔇"}
      </span>
    `;

    // Wire up events
    const select = row.querySelector("select")!;
    const slider = row.querySelector('input[type="range"]')! as HTMLInputElement;
    const valueSpan = row.querySelectorAll(".value")[0]!;
    const toggle = row.querySelector(".toggle")!;

    slider.addEventListener("input", () => {
      const gain = parseFloat(slider.value);
      state.filters[filter.index].gain = gain;
      valueSpan.textContent = `${gain.toFixed(1)} dB`;
      drawGraph();
    });

    select.addEventListener("change", () => {
      state.filters[filter.index].filter_type = select.value as Filter["filter_type"];
      drawGraph();
    });

    toggle.addEventListener("click", () => {
      state.filters[filter.index].enabled = !state.filters[filter.index].enabled;
      renderBands();
      drawGraph();
    });

    bandsContainer.appendChild(row);
  }
}

function drawGraph() {
  const w = eqGraph.width;
  const h = eqGraph.height;

  graphCtx.clearRect(0, 0, w, h);

  // Background
  graphCtx.fillStyle = "#1a1d27";
  graphCtx.fillRect(0, 0, w, h);

  if (state.filters.length === 0) return;

  // Grid lines
  graphCtx.strokeStyle = "#242838";
  graphCtx.lineWidth = 1;
  for (let y = 0; y < h; y += 40) {
    graphCtx.beginPath();
    graphCtx.moveTo(0, y);
    graphCtx.lineTo(w, y);
    graphCtx.stroke();
  }

  // Frequency labels
  graphCtx.fillStyle = "#7f85a2";
  graphCtx.font = "11px Inter, sans-serif";
  const freqLabels = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  for (const f of freqLabels) {
    const x = freqToX(f, w);
    graphCtx.fillText(formatFreq(f), x, h - 6);
    graphCtx.beginPath();
    graphCtx.moveTo(x, 0);
    graphCtx.lineTo(x, h);
    graphCtx.strokeStyle = "#242838";
    graphCtx.stroke();
  }

  // Compute summed response
  const points: number[] = [];
  for (let px = 0; px < w; px++) {
    const freq = xToFreq(px, w);
    let sumGain = 0;
    // Global gain offset
    sumGain += state.global_gain;

    for (const filter of state.filters) {
      if (!filter.enabled) continue;
      sumGain += computePeakGain(freq, filter.freq, filter.gain, filter.q);
    }
    points.push(sumGain);
  }

  // Find max/min for scaling
  let maxGain = Math.max(...points, 6);
  let minGain = Math.min(...points, -6);
  const range = Math.max(maxGain - minGain, 12);
  const midY = h / 2;
  const scale = (h * 0.85) / range;

  // Draw curve
  graphCtx.beginPath();
  graphCtx.strokeStyle = "#6c8cff";
  graphCtx.lineWidth = 2.5;
  for (let px = 0; px < points.length; px++) {
    const y = midY - (points[px] - (maxGain + minGain) / 2) * scale;
    if (px === 0) graphCtx.moveTo(px, y);
    else graphCtx.lineTo(px, y);
  }
  graphCtx.stroke();

  // Fill under curve
  graphCtx.lineTo(w, h);
  graphCtx.lineTo(0, h);
  graphCtx.closePath();
  graphCtx.fillStyle = "rgba(108, 140, 255, 0.08)";
  graphCtx.fill();
}

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

function formatFreq(f: number): string {
  if (f >= 1000) return `${(f / 1000).toFixed(0)}k`;
  return `${f}`;
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function loadState() {
  try {
    state = await invoke<PEQData>("get_eq_state");
    globalGainSlider.value = state.global_gain.toString();
    globalGainValue.textContent = `${state.global_gain} dB`;
    renderBands();
    drawGraph();
  } catch (e) {
    statusEl.textContent = `Error loading state: ${e}`;
  }
}

async function scanDevices() {
  scanBtn.disabled = true;
  statusEl.textContent = "Scanning for devices...";
  try {
    const devices: DeviceInfo[] = await invoke("list_devices");
    deviceSelect.innerHTML = "";
    if (devices.length === 0) {
      deviceSelect.innerHTML = '<option value="">No devices found</option>';
      connectBtn.disabled = true;
      statusEl.textContent = "No compatible DACs found";
    } else {
      for (const d of devices) {
        const opt = document.createElement("option");
        opt.value = d.path;
        opt.textContent = d.product_string || `${d.vendor_id.toString(16)}:${d.product_id.toString(16)}`;
        deviceSelect.appendChild(opt);
      }
      connectBtn.disabled = false;
      statusEl.textContent = `Found ${devices.length} device(s)`;
    }
    deviceSelect.disabled = false;
  } catch (e) {
    statusEl.textContent = `Scan failed: ${e}`;
  } finally {
    scanBtn.disabled = false;
  }
}

async function connectDevice() {
  const path = deviceSelect.value;
  if (!path) return;
  connectBtn.disabled = true;
  statusEl.textContent = `Connecting to ${path}...`;
  try {
    await invoke("connect_device", { path });
    statusEl.textContent = "Connected";
    applyBtn.disabled = false;
    await loadState();
  } catch (e) {
    statusEl.textContent = `Connection failed: ${e}`;
    connectBtn.disabled = false;
  }
}

async function applyState() {
  applyBtn.disabled = true;
  try {
    await invoke("set_eq_state", { peq: state });
    statusEl.textContent = "EQ applied to device ✅";
  } catch (e) {
    statusEl.textContent = `Apply failed: ${e}`;
  } finally {
    applyBtn.disabled = false;
  }
}

function resetFlat() {
  for (const filter of state.filters) {
    filter.enabled = false;
    filter.gain = 0;
    filter.freq = 1000;
    filter.q = 1.0;
    filter.filter_type = "Peak";
  }
  state.global_gain = 0;
  // Enable a middle band
  if (state.filters[4]) {
    state.filters[4].enabled = true;
    state.filters[4].freq = 1000;
  }
  globalGainSlider.value = "0";
  globalGainValue.textContent = "0 dB";
  renderBands();
  drawGraph();
  statusEl.textContent = "Reset to flat";
}

// ── Global gain handler ───────────────────────────────────────────────────────

globalGainSlider.addEventListener("input", () => {
  state.global_gain = parseInt(globalGainSlider.value);
  globalGainValue.textContent = `${state.global_gain} dB`;
  drawGraph();
});

// ── Event wiring ─────────────────────────────────────────────────────────────

scanBtn.addEventListener("click", scanDevices);
connectBtn.addEventListener("click", connectDevice);
applyBtn.addEventListener("click", applyState);
flatBtn.addEventListener("click", resetFlat);

// ── Init ─────────────────────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", async () => {
  await loadState();
  // Auto-scan on startup
  scanDevices();
});
