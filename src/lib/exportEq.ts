// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import type { StatusReporter } from "../stores/toastStore";
import type { PEQData } from "../types";
import { invoke, save, writeText } from "./rpc";

// AutoEQ ParametricEQ text, which Equalizer APO, EasyEffects and Wavelet import.
function autoEqText(peq: PEQData): Promise<string> {
  return invoke<string>("peq_to_autoeq", { peq });
}

export async function copyEq(peq: PEQData, setStatus: StatusReporter): Promise<void> {
  try {
    await writeText(await autoEqText(peq));
    setStatus("Copied EQ to clipboard");
  } catch (err) {
    setStatus(`Failed to copy: ${err}`);
  }
}

export async function exportEqFile(peq: PEQData, baseName: string, setStatus: StatusReporter): Promise<void> {
  try {
    const text = await autoEqText(peq);
    const defaultName = `${(baseName || "eq_profile").replace(/[^a-zA-Z0-9_\-@+&.() ]/g, "")}.txt`;
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: "Text Files", extensions: ["txt"] }],
    });
    if (!path) {
      setStatus("Export cancelled.");
      return;
    }
    const savedName = await invoke<string | null>("save_text_file", { path, content: text });
    if (savedName === null) {
      setStatus("Export cancelled.");
      return;
    }
    setStatus("Exported EQ profile");
  } catch (err) {
    setStatus(`Failed to export: ${err}`);
  }
}
