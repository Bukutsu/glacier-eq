// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

export type CommandArgs = Record<string, unknown> | number[] | ArrayBuffer | Uint8Array;

type FileDialogOptions = {
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
};

const SAVE_TEXT_DIALOG_TOKEN = "tauri-save-text-dialog:";

export async function listen<T>(
  event: string,
  callback: (event: { payload: T }) => void,
): Promise<() => void> {
  const { listen: tauriListen } = await import("@tauri-apps/api/event");
  return tauriListen(event, callback);
}

export async function emit(event: string, payload?: unknown): Promise<void> {
  const { emit: tauriEmit } = await import("@tauri-apps/api/event");
  return tauriEmit(event, payload);
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function invoke<T = unknown>(cmd: string, args?: CommandArgs): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  if (cmd === "save_text_file") {
    const dialogRequest = parseSaveTextDialogRequest(args);
    if (dialogRequest) {
      return tauriInvoke<T>("save_text_file_dialog", dialogRequest);
    }
  }
  return tauriInvoke<T>(cmd, args);
}

function parseSaveTextDialogRequest(
  args: unknown,
): { content: string; defaultName: string } | null {
  if (typeof args !== "object" || args === null || !("path" in args) || !("content" in args)) {
    return null;
  }
  if (typeof args.path !== "string" || !args.path.startsWith(SAVE_TEXT_DIALOG_TOKEN)) {
    return null;
  }
  if (typeof args.content !== "string") {
    throw new Error("Invalid text export content");
  }
  const encodedName = args.path.slice(SAVE_TEXT_DIALOG_TOKEN.length);
  let defaultName: string;
  try {
    defaultName = decodeURIComponent(encodedName);
  } catch {
    throw new Error("Invalid text export file name");
  }
  return { content: args.content, defaultName };
}

export async function requestWebHidDevice(): Promise<void> {
  throw new Error("WebHID is only available in the browser runtime");
}

export async function readText(): Promise<string> {
  const { readText: tauriReadText } = await import("@tauri-apps/plugin-clipboard-manager");
  return tauriReadText();
}

export async function writeText(text: string): Promise<void> {
  const { writeText: tauriWriteText } = await import("@tauri-apps/plugin-clipboard-manager");
  return tauriWriteText(text);
}

export async function save(options?: FileDialogOptions): Promise<string | null> {
  const defaultName = options?.defaultPath || "profile.txt";
  return `${SAVE_TEXT_DIALOG_TOKEN}${encodeURIComponent(defaultName)}`;
}

function parseOpenedTextFile(value: unknown): { text: string; name: string } | null {
  if (value === null) return null;
  if (
    typeof value !== "object" ||
    !("text" in value) ||
    typeof value.text !== "string" ||
    !("name" in value) ||
    typeof value.name !== "string"
  ) {
    throw new Error("Invalid open-file response from backend");
  }
  return { text: value.text, name: value.name };
}

export async function openFileDialog(_options?: {
  filters?: { name: string; extensions: string[] }[];
}): Promise<{ text: string; name: string } | null> {
  return parseOpenedTextFile(await invoke<unknown>("open_text_file_dialog"));
}

