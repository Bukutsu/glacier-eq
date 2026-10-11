const TEXT_ENTRY = 'textarea, input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="file"]):not([type="color"]), [contenteditable="true"]';
const INTERACTIVE = 'button, a, input, textarea, select, label, [role="button"], [role="slider"], [role="combobox"], [role="switch"], [role="menuitem"], [contenteditable="true"], .control-slider, .eq-filter-handle, canvas, svg';

/** A deliberate blank-area tap dismisses the keyboard; scrolling and handled
 * controls do not. Never prevent the browser's first tap from reaching an action. */
export function installKeyboardTapDismissal(doc: Document): () => void {
  let tap: { id: number; x: number; y: number; active: HTMLElement } | null = null;
  const down = (event: PointerEvent) => {
    tap = null;
    if (event.pointerType !== "touch" || event.isPrimary === false || event.defaultPrevented) return;
    const active = doc.activeElement;
    const target = event.target;
    if (!(active instanceof HTMLElement) || !active.matches(TEXT_ENTRY)
      || !(target instanceof Element) || target.closest(INTERACTIVE)) return;
    tap = { id: event.pointerId, x: event.clientX, y: event.clientY, active };
  };
  const move = (event: PointerEvent) => {
    if (tap?.id === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 8) tap = null;
  };
  const up = (event: PointerEvent) => {
    const candidate = tap;
    tap = null;
    if (candidate?.id !== event.pointerId || event.defaultPrevented
      || Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) > 8) return;
    if (doc.activeElement === candidate.active) candidate.active.blur();
  };
  const cancel = () => { tap = null; };
  doc.addEventListener("pointerdown", down, { passive: true });
  doc.addEventListener("pointermove", move, { passive: true });
  doc.addEventListener("pointerup", up, { passive: true });
  doc.addEventListener("pointercancel", cancel, { passive: true });
  return () => {
    cancel();
    doc.removeEventListener("pointerdown", down);
    doc.removeEventListener("pointermove", move);
    doc.removeEventListener("pointerup", up);
    doc.removeEventListener("pointercancel", cancel);
  };
}
