// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import { memo, type ComponentType } from "react";
import {
  Activity,
  Check,
  CheckCircle2,
  Circle,
  CircleDot,
  Cpu,
  Folder,
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
  Code2,
  Copy,
  Download,
  ExternalLink,
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

// Deliberately not annotated as Record<string, ...>: the annotation widens
// the keys to string, which is exactly what let a typo through to a silent
// `return null` in the shipped build. `satisfies` checks the values and keeps
// the literal keys, so IconName below is the real closed set.
const ICON_MAP = {
  add: Plus,
  remove: Minus,
  close: X,
  check: Check,
  check_circle: CheckCircle2,
  delete: Trash2,
  refresh: RotateCw,
  restart_alt: RotateCcw,
  save: Save,
  tune: SlidersHorizontal,
  palette: Palette,
  settings: Settings,
  memory: Cpu,
  folder: Folder,
  auto_awesome: Sparkles,
  expand_more: ChevronDown,
  expand_less: ChevronUp,
  chevron_right: ChevronRight,
  chevron_left: ChevronLeft,
  arrow_back: ArrowLeft,
  search: Search,
  search_off: SearchX,
  info: Info,
  open_in_new: ExternalLink,
  code: Code2,
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
  radio_button_checked: CircleDot,
  radio_button_unchecked: Circle,
} satisfies Record<string, ComponentType<{ size?: number | string; className?: string }>>;

/** The icon names this build ships. A name outside it cannot be written. */
export type IconName = keyof typeof ICON_MAP;

export const Icon = memo(function Icon({
  name,
  className = "",
  size = 18,
}: {
  name: IconName;
  className?: string;
  size?: number | string;
}) {
  // Total by construction: name is IconName, so the lookup cannot miss. A
  // typo used to return null here, silently, with the only warning behind
  // import.meta.env.DEV and so stripped from the production bundle.
  const Component = ICON_MAP[name];
  return (
    <Component
      className={`app-icon ${className}`}
      size={size}
      strokeWidth={1.75}
      aria-hidden="true"
    />
  );
});
