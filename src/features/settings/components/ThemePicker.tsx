import { useId } from "react";
import type { AppSettings } from "@/types";
import type { ThemeOption } from "@/features/settings/lib/theme";
import { Icon } from "@/components/ui/Icon";

// Small samples of the UI palette, not the independently colored EQ traces.
export const THEME_PREVIEWS: Readonly<
  Record<string, readonly [string, string, string]>
> = {
  glacier: ["#181c20", "#e5eaee", "#394147"],
  "glacier-light": ["#f3f5f6", "#263039", "#ccd4d9"],
  "tokyo-night": ["#20212b", "#b0b4cb", "#4c5b7e"],
  "tokyo-night-storm": ["#282b35", "#bbc0d2", "#4c5b7e"],
  "tokyo-night-day": ["#e6e7ed", "#343b59", "#426cb3"],
  nord: ["#2e3440", "#eceff4", "#42576b"],
  dracula: ["#191a21", "#f8f8f2", "#574e70"],
  gruvbox: ["#282828", "#ebdbb2", "#4d5844"],
  "catppuccin-mocha": ["#1e1e2e", "#cdd6f4", "#5e526f"],
  "catppuccin-latte": ["#e6e9ef", "#4c4f69", "#665a7a"],
} as const;

export function ThemePicker({
  value,
  options,
  onChange,
}: {
  value: AppSettings["theme"];
  options: readonly ThemeOption[];
  onChange: (value: AppSettings["theme"]) => void;
}) {
  const name = useId();
  return (
    <fieldset className="theme-picker">
      <legend>Color theme</legend>
      <div className="theme-picker-options">
        {options.map((option) => {
          const palette =
            option.value === "auto" || option.value === "material-you"
              ? null
              : THEME_PREVIEWS[option.value];
          return (
            <label key={option.value} className="theme-picker-option">
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
              />
              {palette ? (
                <span
                  className="theme-swatch"
                  aria-hidden="true"
                  style={{ backgroundColor: palette[0] }}
                >
                  <span style={{ backgroundColor: palette[1] }} />
                  <span style={{ backgroundColor: palette[2] }} />
                </span>
              ) : (
                <span
                  className="theme-swatch theme-swatch-system"
                  aria-hidden="true"
                >
                  <Icon
                    name={option.value === "auto" ? "auto_awesome" : "palette"}
                  />
                </span>
              )}
              <span className="theme-picker-label">{option.label}</span>
              <Icon name="check" className="theme-picker-check" />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
