// Filter band colors, ordered as a warm→cool hue progression that maps to
// frequency: band 1 (31 Hz, bass) is warm and band 10 (16 kHz, treble) is cool.
// Bands 1–8 are distinct hues; the two cyan variants are reserved for the
// highest "air" bands, which are less commonly used.
const FILTER_COLOR_VARS = [
  ["--red", "--red-rgb", "#f7768e"],
  ["--orange", "--orange-rgb", "#ff9e64"],
  ["--yellow", "--yellow-rgb", "#e0af68"],
  ["--green", "--green-rgb", "#9ece6a"],
  ["--teal", "--teal-rgb", "#73daca"],
  ["--cyan", "--cyan-rgb", "#7dcfff"],
  ["--blue", "--blue-rgb", "#7aa2f7"],
  ["--purple", "--purple-rgb", "#9d7cd8"],
  ["--dark-cyan", "--dark-cyan-rgb", "#2ac3de"],
  ["--bright-cyan", "--bright-cyan-rgb", "#b4f9f8"],
] as const;

export function filterColorVars(index: number) {
  return FILTER_COLOR_VARS[index % FILTER_COLOR_VARS.length];
}
