// Filter band colors, ordered as a warm→cool hue progression that maps to
// frequency: band 1 (31 Hz, bass) is warm and band 10 (16 kHz, treble) is cool.
// All ten are distinct hues; bands 9–10 use the two extra tokens instead of
// the old cyan look-alikes so no two bands are easily confused.
const FILTER_COLOR_VARS = [
  ["--plot-red", "--plot-red-rgb", "#e06c75"],
  ["--plot-orange", "--plot-orange-rgb", "#d19a66"],
  ["--plot-yellow", "--plot-yellow-rgb", "#e5c07b"],
  ["--plot-green", "--plot-green-rgb", "#8cc265"],
  ["--plot-teal", "--plot-teal-rgb", "#56b6c2"],
  ["--plot-cyan", "--plot-cyan-rgb", "#56c8d8"],
  ["--plot-blue", "--plot-blue-rgb", "#61afef"],
  ["--plot-purple", "--plot-purple-rgb", "#c678dd"],
  ["--plot-teal2", "--plot-teal2-rgb", "#1abc9c"],
  ["--plot-magenta2", "--plot-magenta2-rgb", "#ff007c"],
] as const;

export function filterColorVars(index: number) {
  return FILTER_COLOR_VARS[index % FILTER_COLOR_VARS.length];
}
