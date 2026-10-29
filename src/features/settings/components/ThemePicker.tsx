import { useTranslation } from "react-i18next";
import { useId } from "react";
import type { AppSettings } from "@/types";
import type { ThemeOption } from "@/features/settings/lib/theme";
import { Icon } from "@/components/ui/Icon";

// Small samples of the UI palette, not the independently colored EQ traces.
const THEME_PREVIEWS: Readonly<
  Record<string, readonly [string, string, string]>
> = {
  glacier: ["#101119", "#c9d1e2", "#2d4263"],
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

const FIELDSET = "m-0 min-w-0 border-0 p-[var(--space-4)]";
const LEGEND = "float-left mb-[var(--space-3)] w-full p-0 text-[length:var(--type-label)] font-medium";
const OPTIONS = "clear-both grid grid-cols-2 gap-[var(--space-2)]";
const OPTION =
  "group relative flex min-h-[64px] cursor-pointer items-center gap-[var(--space-2)] border border-[var(--border)] box-border rounded-[var(--control-radius)] p-[var(--space-2)] active:bg-[var(--accent)] has-[input:checked]:border-[var(--ring)] has-[input:checked]:bg-[var(--accent)] has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring max-[360px]:flex-wrap";
const RADIO = "absolute h-px w-px opacity-0";
const LABEL =
  "min-w-0 flex-1 text-[length:var(--type-small)] leading-[1.4] [overflow-wrap:anywhere] max-[360px]:order-1 max-[360px]:basis-[calc(100%_-_24px)]";
const CHECK = "h-[14px] w-[14px] shrink-0 invisible group-has-[input:checked]:visible";
const SWATCH =
  "box-border flex h-[30px] w-[34px] shrink-0 flex-col justify-center gap-1 rounded-[4px] border border-[var(--border)] p-1.5 [&>span]:h-[3px] [&>span]:rounded-[1px] [&>span:last-child]:w-[65%]";
const SWATCH_SYSTEM = "items-center bg-[var(--background)] [&>.app-icon]:h-[18px] [&>.app-icon]:w-[18px]";

export function ThemePicker({
  value,
  options,
  onChange,
}: {
  value: AppSettings["theme"];
  options: readonly ThemeOption[];
  onChange: (value: AppSettings["theme"]) => void;
}) {
  const { t } = useTranslation("settings");
  const name = useId();
  return (
    <fieldset className={FIELDSET}>
      <legend className={LEGEND}>{t("appearance.colorTheme")}</legend>
      <div className={OPTIONS}>
        {options.map((option) => {
          const palette =
            option.value === "auto" || option.value === "material-you"
              ? null
              : THEME_PREVIEWS[option.value];
          return (
            <label key={option.value} className={OPTION}>
              <input
                type="radio"
                className={RADIO}
                name={name}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
              />
              {palette ? (
                <span
                  className={SWATCH}
                  aria-hidden="true"
                  style={{ backgroundColor: palette[0] }}
                >
                  <span style={{ backgroundColor: palette[1] }} />
                  <span style={{ backgroundColor: palette[2] }} />
                </span>
              ) : (
                <span
                  className={`${SWATCH} ${SWATCH_SYSTEM}`}
                  aria-hidden="true"
                >
                  <Icon
                    name={option.value === "auto" ? "auto_awesome" : "palette"}
                  />
                </span>
              )}
              <span className={LABEL}>{option.label}</span>
              <Icon name="check" className={CHECK} />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
