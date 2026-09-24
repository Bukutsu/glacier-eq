export function decodeUtf8(bytes: ArrayBuffer): string {
  // Keep BOM bytes visible to the parser so a second encoded BOM cannot be
  // silently consumed by the decoder before duplicate-marker validation.
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}
