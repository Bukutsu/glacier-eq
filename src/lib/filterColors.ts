// Filter band colors, ordered as a warm→cool hue progression that maps to
// frequency: band 1 (31 Hz, bass) is warm and band 10 (16 kHz, treble) is cool.
// All ten are distinct hues; bands 9–10 use the two extra tokens instead of
// the old cyan look-alikes so no two bands are easily confused.
const FILTER_COLOR_VARS = [
  ["--red", "--red-rgb", "#e06c75"],
  ["--orange", "--orange-rgb", "#d19a66"],
  ["--yellow", "--yellow-rgb", "#e5c07b"],
  ["--green", "--green-rgb", "#8cc265"],
  ["--teal", "--teal-rgb", "#56b6c2"],
  ["--cyan", "--cyan-rgb", "#56c8d8"],
  ["--blue", "--blue-rgb", "#61afef"],
  ["--purple", "--purple-rgb", "#c678dd"],
  ["--teal2", "--teal2-rgb", "#1abc9c"],
  ["--magenta2", "--magenta2-rgb", "#ff007c"],
] as const;

export function filterColorVars(index: number) {
  return FILTER_COLOR_VARS[index % FILTER_COLOR_VARS.length];
}
