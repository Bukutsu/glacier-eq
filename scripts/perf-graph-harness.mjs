// [PERF-PROBE] Deterministic UI graph response harness: warmup + median.
import { peqResponseAndBandValues } from "../src/lib/graphMath.ts";

const WIDTH = 1280;
const freqs = new Float32Array(WIDTH);
for (let i = 0; i < WIDTH; i++) freqs[i] = 20 * 1000 ** (i / (WIDTH - 1));

const peq = {
  global_gain: -4,
  filters: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((freq, index) => ({
    index,
    enabled: true,
    filter_type: index === 0 ? "LowShelf" : index === 1 ? "HighShelf" : "Peak",
    freq,
    gain: [2.5, 1.5, -1.5, -3.5, -2, 0.5, 3, 2, -1, 1][index],
    q: [0.7, 0.9, 1.1, 1.4, 1, 1.2, 1.5, 1.1, 0.8, 1][index],
  })),
};

const WARMUP = 20;
const RUNS = 15;
for (let i = 0; i < WARMUP; i++) peqResponseAndBandValues(peq, freqs, true, 96000);

const times = [];
for (let i = 0; i < RUNS; i++) {
  const t0 = performance.now();
  peqResponseAndBandValues(peq, freqs, true, 96000);
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)];
console.log(`median_ms=${median.toFixed(4)}`);
console.log(`runs_ms=${times.map((t) => t.toFixed(4)).join(",")}`);
