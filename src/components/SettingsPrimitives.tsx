// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { Icon } from "./Icon";
import { Select, type SelectOption } from "./Select";

export function StackHeader({
  title,
  backTo,
  backLabel = "Back",
  actions,
}: {
  title: string;
  backTo?: string;
  backLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="stack-topbar">
      {backTo ? (
        <NavLink to={backTo} className="stack-back-btn" aria-label={backLabel}>
          <Icon>arrow_back</Icon>
        </NavLink>
      ) : null}
      <h1 className="stack-topbar-title">{title}</h1>
      {actions ? <div className="stack-topbar-actions">{actions}</div> : null}
    </header>
  );
}

export function CategoryHeader({ title }: { title: string }) {
  return <div className="stack-category-header">{title}</div>;
}

export function NavRow({
  to,
  icon,
  title,
  desc,
}: {
  to: string;
  icon: string;
  title: string;
  desc?: string;
}) {
  return (
    <NavLink to={to} className="stack-nav-row">
      <Icon className="stack-row-icon">{icon}</Icon>
      <div className="stack-row-content">
        <span className="stack-row-title">{title}</span>
        {desc ? <span className="stack-row-desc">{desc}</span> : null}
      </div>
      <Icon className="stack-row-chevron">chevron_right</Icon>
    </NavLink>
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
  return (
    <label className={`stack-pref-row interactive ${disabled ? "disabled" : ""}`}>
      <div className="stack-pref-info">
        <span className="stack-pref-title">{title}</span>
        {desc ? <span className="stack-pref-desc">{desc}</span> : null}
      </div>
      <div className="stack-pref-control">
        <input
          type="checkbox"
          className="custom-checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
      </div>
    </label>
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
        <div className="setting-select-wrapper">
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
  icon?: string;
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
        <button
          type="button"
          className={`btn ${danger ? "danger" : ""}`}
          disabled={disabled}
          onClick={onAction}
        >
          {icon ? <Icon>{icon}</Icon> : null}
          <span>{actionLabel}</span>
        </button>
      </div>
    </div>
  );
}
