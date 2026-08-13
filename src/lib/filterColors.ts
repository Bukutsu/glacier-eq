const FILTER_COLOR_VARS = [
  ["--blue", "--blue-rgb", "#7aa2f7"],
  ["--orange", "--orange-rgb", "#ff9e64"],
  ["--cyan", "--cyan-rgb", "#7dcfff"],
  ["--green", "--green-rgb", "#9ece6a"],
  ["--teal", "--teal-rgb", "#73daca"],
  ["--red", "--red-rgb", "#f7768e"],
  ["--dark-cyan", "--dark-cyan-rgb", "#2ac3de"],
  ["--purple", "--purple-rgb", "#bb9af7"],
  ["--yellow", "--yellow-rgb", "#e0af68"],
  ["--bright-cyan", "--bright-cyan-rgb", "#b4f9f8"],
] as const;

export function filterColorVars(index: number) {
  return FILTER_COLOR_VARS[index % FILTER_COLOR_VARS.length];
}
