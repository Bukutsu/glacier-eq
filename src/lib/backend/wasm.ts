// Copyright (c) 2026 Bukutsu
// SPDX-License-Identifier: GPL-3.0-only

import initWasm, {
  list_supported_devices,
  parse_autoeq,
  peq_to_autoeq,
  normalize_peq_for_device,
  is_default_peq_for_device,
  match_profile_name,
  run_autoeq,
  build_init_packets,
  build_read_filter_request,
  matches_filter_response,
  parse_filter_response,
  build_read_global_gain_request,
  matches_global_gain_response,
  parse_global_gain_response,
  build_write_filter_packets,
  build_write_global_gain_packets,
  build_commit_packets,
  build_ram_apply_packets,
  build_filter_mode_write_packet,
  build_amp_mode_write_packet,
  build_gain_mode_write_packet,
  build_balance_write_packets,
  build_mic_volume_write_packet,
  build_factory_reset_packet,
  build_flash_eq_packet,
  get_write_timing,
} from "../../wasm_pkg/glacier_core";

let wasmInitPromise: Promise<unknown> | null = null;

export async function ensureWasm(): Promise<void> {
  wasmInitPromise ??= initWasm();
  await wasmInitPromise;
}

export {
  list_supported_devices,
  parse_autoeq,
  peq_to_autoeq,
  normalize_peq_for_device,
  is_default_peq_for_device,
  match_profile_name,
  run_autoeq,
  build_init_packets,
  build_read_filter_request,
  matches_filter_response,
  parse_filter_response,
  build_read_global_gain_request,
  matches_global_gain_response,
  parse_global_gain_response,
  build_write_filter_packets,
  build_write_global_gain_packets,
  build_commit_packets,
  build_ram_apply_packets,
  build_filter_mode_write_packet,
  build_amp_mode_write_packet,
  build_gain_mode_write_packet,
  build_balance_write_packets,
  build_mic_volume_write_packet,
  build_factory_reset_packet,
  build_flash_eq_packet,
  get_write_timing,
};
