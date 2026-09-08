import { bench, describe } from "vitest";
import type { PEQData } from "../src/types";
import {
  peqResponseAndBandValues,
  peqResponseValues,
} from "../src/lib/graphMath";

const WIDTH = 1280;
const freqs = new Float32Array(WIDTH);
for (let index = 0; index < WIDTH; index++) {
  freqs[index] = 20 * 1000 ** (index / (WIDTH - 1));
}

const peq: PEQData = {
  global_gain: -4,
  filters: Array.from({ length: 10 }, (_, index) => ({
    index,
    enabled: true,
    filter_type: index === 0 ? "LowShelf" : index === 1 ? "HighShelf" : "Peak",
    freq: [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000][index],
    gain: [2.5, 1.5, -1.5, -3.5, -2, 0.5, 3, 2, -1, 1][index],
    q: [0.7, 0.9, 1.1, 1.4, 1, 1.2, 1.5, 1.1, 0.8, 1][index],
  })),
};

describe("UI graph response", () => {
  bench("aggregate response", () => {
    peqResponseValues(peq, freqs, true, 96000);
  });

  bench("aggregate and per-band response", () => {
    peqResponseAndBandValues(peq, freqs, true, 96000);
  });
});
