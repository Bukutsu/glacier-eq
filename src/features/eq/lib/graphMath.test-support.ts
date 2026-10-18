import type { Filter } from "@/types";

// Fitted Moondrop AutoEQ shelf: q stores RBJ shelf slope S, not canonical Q.
export const fittedMoondropShelf: Filter = {
  index: 0,
  enabled: true,
  filter_type: "LowShelf",
  freq: 442,
  gain: 6.234375,
  q: 0.69921875,
};
export const shelfFreqs = new Float32Array([221, 884]);
export const slopeShelfDb = [5.359842, 0.87424];
export const canonicalShelfDb = [5.812542, 0.421598];
