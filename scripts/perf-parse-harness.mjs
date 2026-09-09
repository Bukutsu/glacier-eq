// [PERF-PROBE] Deterministic measurement-text parse harness: warmup + median.
import { parseMeasurementText } from "../src/lib/measurements.ts";

function buildInput(lines) {
  const out = ["# synthetic measurement export", "// 4000-point sweep"];
  for (let i = 0; i < lines; i++) {
    const freq = 20 * (20000 / 20) ** (i / (lines - 1));
    const db = (Math.sin(i * 0.37) * 6 + Math.cos(i * 0.11) * 3).toFixed(3);
    const sep = i % 3 === 0 ? "," : i % 3 === 1 ? "\t" : " ";
    out.push(`${freq.toFixed(2)}${sep}${db}`);
  }
  return out.join("\n");
}

const text = buildInput(4000);
console.log(`input_bytes=${text.length}`);

const WARMUP = 5;
const RUNS = 11;
for (let i = 0; i < WARMUP; i++) parseMeasurementText(text);

const times = [];
for (let i = 0; i < RUNS; i++) {
  const t0 = performance.now();
  parseMeasurementText(text);
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)];
console.log(`median_ms=${median.toFixed(3)}`);
console.log(`runs_ms=${times.map((t) => t.toFixed(3)).join(",")}`);
