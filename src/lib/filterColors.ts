export const FILTER_COLOR_VARS = [
  ["--blue", "--blue-rgb", "#7aa2f7"],
  ["--green", "--green-rgb", "#9ece6a"],
  ["--orange", "--orange-rgb", "#ff9e64"],
  ["--yellow", "--yellow-rgb", "#e0af68"],
  ["--red", "--red-rgb", "#f7768e"],
  ["--purple", "--purple-rgb", "#bb9af7"],
  ["--teal", "--teal-rgb", "#73daca"],
  ["--dark-cyan", "--dark-cyan-rgb", "#2ac3de"],
  ["--bright-cyan", "--bright-cyan-rgb", "#b4f9f8"],
  ["--cyan", "--cyan-rgb", "#7dcfff"],
] as const;

export function filterColorVars(index: number) {
  return FILTER_COLOR_VARS[index % FILTER_COLOR_VARS.length];
}
