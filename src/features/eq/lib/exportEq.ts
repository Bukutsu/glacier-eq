import { i18n } from "@/lib/i18n";
// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import type { StatusReporter } from "@/stores/toastStore";
import type { PEQData } from "@/types";
import { invoke, save, writeText } from "@/lib/rpc";

// AutoEQ ParametricEQ text, which Equalizer APO, EasyEffects and Wavelet import.
function autoEqText(peq: PEQData): Promise<string> {
  return invoke<string>("peq_to_autoeq", { peq });
}

export async function copyEq(
  peq: PEQData,
  setStatus: StatusReporter,
): Promise<void> {
  try {
    await writeText(await autoEqText(peq));
    setStatus(i18n.t("editor:export.copied"));
  } catch (err) {
    setStatus(i18n.t("editor:export.copyFailed", { error: String(err) }));
  }
}

export async function exportEqFile(
  peq: PEQData,
  baseName: string,
  setStatus: StatusReporter,
): Promise<void> {
  try {
    const text = await autoEqText(peq);
    const safeName = baseName.replace(/[^\p{L}\p{N}\p{M}_\-@+&.() ]/gu, "").trim();
    const defaultName = `${safeName || "eq_profile"}.txt`;
    const path = await save({
      defaultPath: defaultName,
      filters: [
        { name: i18n.t("editor:export.textFiles"), extensions: ["txt"] },
      ],
    });
    if (!path) {
      setStatus(i18n.t("editor:export.cancelled"));
      return;
    }
    const savedName = await invoke<string | null>("save_text_file", {
      path,
      content: text,
    });
    if (savedName === null) {
      setStatus(i18n.t("editor:export.cancelled"));
      return;
    }
    setStatus(i18n.t("editor:export.success"));
  } catch (err) {
    setStatus(i18n.t("editor:export.failed", { error: String(err) }));
  }
}
