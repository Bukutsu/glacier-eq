// Filter band colors, ordered as a warm→cool hue progression that maps to
// frequency: band 1 (31 Hz, bass) is warm and band 10 (16 kHz, treble) is cool.
// All ten are distinct hues; bands 9–10 use the two extra tokens instead of
// the old cyan look-alikes so no two bands are easily confused.
const FILTER_COLOR_VARS = [
  ["--red", "--red-rgb", "#f7768e"],
  ["--orange", "--orange-rgb", "#ff9e64"],
  ["--yellow", "--yellow-rgb", "#e0af68"],
  ["--green", "--green-rgb", "#9ece6a"],
  ["--teal", "--teal-rgb", "#73daca"],
  ["--cyan", "--cyan-rgb", "#7dcfff"],
  ["--blue", "--blue-rgb", "#7aa2f7"],
  ["--purple", "--purple-rgb", "#9d7cd8"],
  ["--teal2", "--teal2-rgb", "#1abc9c"],
  ["--magenta2", "--magenta2-rgb", "#ff007c"],
] as const;

export function filterColorVars(index: number) {
  return FILTER_COLOR_VARS[index % FILTER_COLOR_VARS.length];
}
