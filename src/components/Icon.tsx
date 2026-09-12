// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { memo, type ComponentType } from "react";
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowLeftRight,
  Bug,
  Cable,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardPaste,
  Copy,
  Download,
  Hourglass,
  Info,
  Keyboard,
  Link,
  Settings,
  ListFilter,
  Lock,
  Minus,
  MoreVertical,
  Palette,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  SearchX,
  Send,
  Shield,
  ShieldPlus,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Trash2,
  Undo2,
  Unlink,
  Upload,
  Wrench,
  X,
  Zap,
} from "lucide-react";

export interface SvgIconProps {
  className?: string;
  size?: number | string;
  strokeWidth?: number | string;
  strokeLinecap?: "inherit" | "round" | "butt" | "square";
  strokeLinejoin?: "inherit" | "round" | "miter" | "bevel";
}

function SharpFolder({ size = 18, className = "" }: SvgIconProps) {
  return (
    <svg
      className={`app-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <path d="M22 19H2V5h7l2 3h11v11z" />
    </svg>
  );
}

function SharpCpu({ size = 18, className = "" }: SvgIconProps) {
  return (
    <svg
      className={`app-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="16" height="16" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" />
    </svg>
  );
}

function SharpRadioChecked({ size = 18, className = "" }: SvgIconProps) {
  return (
    <svg
      className={`app-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" />
      <rect x="8" y="8" width="8" height="8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SharpRadioUnchecked({ size = 18, className = "" }: SvgIconProps) {
  return (
    <svg
      className={`app-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" />
    </svg>
  );
}

function SharpCheck({ size = 18, className = "" }: SvgIconProps) {
  return (
    <svg
      className={`app-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SharpCheckCircle({ size = 18, className = "" }: SvgIconProps) {
  return (
    <svg
      className={`app-icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="20" height="20" />
      <polyline points="17 8 10 15 7 12" strokeWidth="2.25" />
    </svg>
  );
}

const ICON_MAP: Record<string, ComponentType<SvgIconProps>> = {
  add: Plus,
  remove: Minus,
  close: X,
  check: SharpCheck,
  check_circle: SharpCheckCircle,
  delete: Trash2,
  refresh: RotateCw,
  restart_alt: RotateCcw,
  save: Save,
  tune: SlidersHorizontal,
  palette: Palette,
  settings: Settings,
  memory: SharpCpu,
  folder: SharpFolder,
  auto_awesome: Sparkles,
  expand_more: ChevronDown,
  expand_less: ChevronUp,
  chevron_right: ChevronRight,
  chevron_left: ChevronLeft,
  arrow_back: ArrowLeft,
  search: Search,
  search_off: SearchX,
  info: Info,
  error: AlertCircle,
  link: Link,
  link_off: Unlink,
  swap_horiz: ArrowLeftRight,
  usb: Cable,
  file_upload: Upload,
  file_download: Download,
  content_paste: ClipboardPaste,
  content_copy: Copy,
  send: Send,
  security: Shield,
  add_moderator: ShieldPlus,
  keyboard: Keyboard,
  terminal: Terminal,
  bug_report: Bug,
  build: Wrench,
  analytics: Activity,
  bolt: Zap,
  hourglass_empty: Hourglass,
  lock: Lock,
  vertical_align_bottom: ArrowDownToLine,
  legend_toggle: ListFilter,
  undo: Undo2,
  redo: Redo2,
  more_vert: MoreVertical,
  radio_button_checked: SharpRadioChecked,
  radio_button_unchecked: SharpRadioUnchecked,
};

export const Icon = memo(function Icon({
  children,
  className = "",
  size = 18,
}: {
  children: string;
  className?: string;
  size?: number | string;
}) {
  const Component = ICON_MAP[children];
  if (!Component) {
    if (import.meta.env.DEV) console.warn(`[Icon] missing sharp icon: "${children}"`);
    return null;
  }
  return (
    <Component
      className={`app-icon sharp-icon ${className}`}
      size={size}
      strokeWidth={2}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    />
  );
});
