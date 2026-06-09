// Shared pointer-drag controller for the canvas. Wires window pointermove/pointerup for the drag,
// plus an Escape key that aborts it: on Escape we run onCancel (revert), tear everything down, and
// do NOT run onUp. Without this a drag could only end by releasing the pointer — and there was no
// way to back out of one mid-flight.
export function startPointerDrag(opts: {
  onMove?: (e: PointerEvent) => void;
  onUp?: (e: PointerEvent) => void;
  onCancel?: () => void;
}) {
  const move = (e: PointerEvent) => opts.onMove?.(e);
  const cleanup = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key, true);
  };
  const up = (e: PointerEvent) => {
    cleanup();
    opts.onUp?.(e);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    cleanup();
    opts.onCancel?.();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", key, true);
}
