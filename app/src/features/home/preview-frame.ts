// Keep only the latest slider preview. Cancelling must discard work even before
// the first frame runs (gesture cancellation, changing books, or closing the panel).
export function createPreviewFrame() {
  let frame: number | null = null;
  let work: (() => void) | null = null;
  return {
    get pending() { return work !== null; },
    schedule(next: () => void) {
      work = next;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const apply = work;
        work = null;
        apply?.();
      });
    },
    cancel() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      work = null;
    },
  };
}
