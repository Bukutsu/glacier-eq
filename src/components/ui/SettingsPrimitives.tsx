import "@/lib/i18n";
import { useTranslation } from "react-i18next";
// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { useId, type ReactNode } from "react";
import { Button } from "./Button";
import { Switch } from "./Switch";
import { NavLink } from "react-router";
import { Icon, type IconName } from "./Icon";
import { Select, type SelectOption } from "./Select";
import { openExternalLink } from "@/lib/externalLinks";

export function StackHeader({
  title,
  backTo,
  backLabel,
  actions,
}: {
  title: string;
  backTo?: string;
  backLabel?: string;
  actions?: ReactNode;
}) {
  const { t } = useTranslation("shell");
  return (
    <header className={`leg:flex leg:items-center leg:gap-[10px] leg:min-h-[52px] leg:p-[0_16px] leg:[background:var(--panel)] leg:[border-bottom:1px_solid_var(--line-soft)] leg:box-border leg:[&.subscreen]:pl-[4px] leg:compact:[.mobile-workspace_&]:sticky leg:compact:[.mobile-workspace_&]:top-[0] leg:compact:[.mobile-workspace_&]:z-[var(--z-sticky)] leg:compact:[.mobile-workspace_&]:min-h-[52px] leg:compact:[.mobile-workspace_&]:p-[0_16px] leg:compact:[.mobile-workspace_&]:[background:var(--panel)] leg:compact:[.mobile-workspace_&]:[border-bottom:1px_solid_var(--line-soft)] leg:compact:[.mobile-workspace_&.subscreen]:pl-[4px] cmp:[.configuration-layout_&]:min-h-[0] cmp:[.configuration-layout_&]:p-[0] cmp:[.configuration-layout_&]:m-[0_0_var(--space-2)] cmp:[.configuration-layout_&]:[background:transparent] cmp:[.configuration-layout_&]:[border:0] cmp:compact:[.configuration-mobile_&]:hidden ${backTo ? " subscreen" : ""}`}>
      {backTo ? (
        <NavLink
          to={backTo}
          className="stack-back-btn leg:inline-flex leg:items-center leg:justify-center leg:w-[44px] leg:h-[44px] leg:text-[color:var(--text)] leg:[background:transparent] leg:[border:none] leg:rounded-[0]! leg:cursor-pointer leg:no-underline leg:[transition:background_120ms_ease,_color_120ms_ease] leg:[&:hover]:[background:var(--surface-soft)] leg:[&:hover]:text-[color:var(--link-foreground)] leg:[&:focus-visible]:[outline:2px_solid_var(--ring)] leg:[&:focus-visible]:[outline-offset:-2px]"
          aria-label={backLabel ?? t("actions.back")}
        >
          <Icon name="arrow_back" />
        </NavLink>
      ) : null}
      <h2 className="stack-topbar-title">{title}</h2>
      {actions ? <div className="stack-topbar-actions">{actions}</div> : null}
    </header>
  );
}

export function ToggleRow({
  title,
  desc,
  checked,
  onChange,
  disabled = false,
}: {
  title: string;
  desc?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const descriptionId = desc ? `${id}-description` : undefined;
  return (
    <label
      htmlFor={id}
      className={`stack-pref-row interactive ${disabled ? "disabled" : ""}`}
    >
      <div className="stack-pref-info">
        <span className="stack-pref-title">{title}</span>
        {desc ? (
          <span id={descriptionId} className="stack-pref-desc">
            {desc}
          </span>
        ) : null}
      </div>
      <div className="stack-pref-control">
        <Switch
          id={id}
          label={title}
          descriptionId={descriptionId}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
        />
      </div>
    </label>
  );
}

/** A row with two or three named choices, for settings where "off" is unclear. */
export function SegmentedRow<T extends string>({
  title,
  desc,
  value,
  options,
  onChange,
  disabled = false,
}: {
  title: string;
  desc?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`stack-pref-row select-row ${disabled ? "disabled" : ""}`}>
      <div className="stack-pref-info">
        <span className="stack-pref-title">{title}</span>
        {desc ? <span className="stack-pref-desc">{desc}</span> : null}
      </div>
      <div className="stack-pref-control">
        <div className="graph-view-toggle leg:grid leg:grid-cols-[repeat(2,_1fr)] leg:w-[116px] leg:min-h-[34px] leg:[background:var(--bg-dark)] leg:compact:min-h-[44px] leg:compact:grid leg:compact:grid-cols-[repeat(2,_1fr)] leg:compact:w-[auto] leg:compact:min-h-[48px]! cmp:[.configuration-layout_&]:flex cmp:[.configuration-layout_&]:w-[240px] cmp:[.configuration-layout_&]:max-w-[100%] cmp:[.configuration-layout_&]:gap-[2px] cmp:[.configuration-layout_&]:p-[3px] cmp:[.configuration-layout_&]:box-border cmp:[.configuration-layout_&]:[border:1px_solid_var(--input)] cmp:[.configuration-layout_&]:rounded-[var(--control-radius)] cmp:[.configuration-layout_&]:[background:var(--field-background)] cmp:max-[1050px]:[.configuration-layout_&&]:w-[100%]" role="group" aria-label={title}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              data-slot="segmented-control"
              className="cmp:flex-[1_1_0] cmp:min-w-[0] cmp:min-h-[28px] cmp:p-[0_var(--space-3)] cmp:[border:0] cmp:rounded-[3px] cmp:[background:transparent] cmp:text-[color:var(--muted-foreground)] cmp:[font:inherit] cmp:[&&]:text-[length:var(--type-label)] cmp:cursor-pointer cmp:[&:hover]:text-[color:var(--foreground)] cmp:[&[aria-pressed='true']]:[background:var(--accent)] cmp:[&&[aria-pressed='true']]:text-[color:var(--accent-foreground)] cmp:[&[aria-pressed='true']]:font-medium cmp:[&:focus-visible]:[outline:2px_solid_var(--ring)] cmp:[&:focus-visible]:[outline-offset:-2px] cmp:compact:[.configuration-layout_&]:min-h-[48px]"
              aria-pressed={value === option.value}
              disabled={disabled}
              onClick={() => {
                if (value !== option.value) onChange(option.value);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SelectRow<T extends string | number>({
  id,
  title,
  desc,
  value,
  options,
  onChange,
  disabled = false,
}: {
  id?: string;
  title: string;
  desc?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`stack-pref-row select-row ${disabled ? "disabled" : ""}`}>
      <div className="stack-pref-info">
        <label className="stack-pref-title" htmlFor={id}>
          {title}
        </label>
        {desc ? <span className="stack-pref-desc">{desc}</span> : null}
      </div>
      <div className="stack-pref-control">
        <div className="leg:flex-[0_1_240px] leg:w-[min(240px,_60%)] leg:min-w-[190px] leg:compact:[.mobile-workspace_.stack-pref-row.select-row_&]:w-[100%]! leg:compact:[.mobile-workspace_.stack-pref-row.select-row_&]:min-w-[100%]! leg:compact:[.mobile-workspace_.stack-pref-row.select-row_&]:flex-[1_1_100%]! cmp:[.configuration-layout_&]:w-[240px] cmp:[.configuration-layout_&]:max-w-[100%] cmp:max-[1050px]:[.configuration-layout_&&]:w-[100%]">
          <Select
            id={id}
            value={value}
            options={options}
            onChange={onChange}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

export function ActionRow({
  title,
  desc,
  actionLabel,
  onAction,
  icon,
  danger = false,
  disabled = false,
}: {
  title: string;
  desc?: string;
  actionLabel: string;
  onAction: () => void;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`stack-pref-row ${danger ? "danger-row" : ""}`}>
      <div className="stack-pref-info">
        <span className="stack-pref-title">{title}</span>
        {desc ? <span className="stack-pref-desc">{desc}</span> : null}
      </div>
      <div className="stack-pref-control">
        <Button
          variant={danger ? "danger" : "default"}
          disabled={disabled}
          onClick={onAction}
        >
          {icon ? <Icon name={icon} /> : null}
          <span>{actionLabel}</span>
        </Button>
      </div>
    </div>
  );
}

export function ExternalLinkRow({
  href,
  icon,
  title,
  desc,
}: {
  href: string;
  icon?: IconName;
  title: string;
  desc?: string;
}) {
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void openExternalLink(href);
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="stack-nav-row leg:flex leg:items-center leg:gap-[16px] leg:min-h-[56px] leg:p-[12px_16px] leg:[background:transparent] leg:[border-bottom:1px_solid_var(--line-subtle)] leg:no-underline leg:text-[color:inherit] leg:cursor-pointer leg:rounded-[0]! leg:[transition:background_120ms_ease] leg:[&:hover]:[background:var(--surface-soft)] leg:[&:focus-visible]:[outline:2px_solid_var(--ring)] leg:[&:focus-visible]:[outline-offset:-2px] leg:[&&:active]:[background:var(--accent)] leg:[.device-navigation_&&&]:[background:transparent] leg:[.device-navigation_&]:[border:0] leg:[.device-navigation_&]:min-h-[72px] leg:[.device-navigation_&&&:hover]:[background:var(--surface-soft)] leg:[.settings-navigation_&&&&]:[background:transparent] leg:[.settings-navigation_&&]:[border:0] leg:[.settings-navigation_&&]:min-h-[72px] leg:[.settings-navigation_&&&&:hover]:[background:var(--surface-soft)] leg:compact:[.mobile-workspace_&&&]:min-h-[60px] leg:compact:[.mobile-workspace_&]:p-[14px_16px] leg:compact:[.mobile-workspace_&]:rounded-[0]! external-link-row cmp:[.configuration-layout_&]:p-[var(--space-3)_0] cmp:[.configuration-layout_&]:gap-[var(--space-3)]"
      onClick={handleClick}
    >
      {icon ? <Icon className="leg:text-[length:22px] leg:text-[color:var(--comment)] leg:shrink-0 leg:[transition:color_120ms_ease] leg:[.stack-nav-row:hover_&]:text-[color:var(--link-foreground)] leg:[.device-navigation_&]:[background:transparent] leg:[.device-navigation_&]:text-[color:var(--muted)] leg:[.settings-navigation_&&]:[background:transparent] leg:[.settings-navigation_&&]:text-[color:var(--muted)]" name={icon} /> : null}
      <div className="leg:flex leg:flex-col leg:gap-[2px] leg:flex-[1_1_auto] leg:min-w-[0]">
        <span className="leg:text-[length:14.5px] leg:font-semibold leg:text-[color:var(--text)] leg:leading-[1.35] cmp:[.configuration-layout_.external-link-row_&]:text-[length:var(--type-label)] cmp:[.configuration-layout_.external-link-row_&]:font-medium">{title}</span>
        {desc ? <span className="leg:text-[length:12px] leg:text-[color:var(--muted)] leg:leading-[1.35]">{desc}</span> : null}
      </div>
      <Icon name="open_in_new" className="leg:text-[length:20px] leg:text-[color:var(--comment)] leg:shrink-0" />
    </a>
  );
}
