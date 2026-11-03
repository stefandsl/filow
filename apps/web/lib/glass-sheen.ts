/** Keep pointer updates outside React; only the dock's decorative backgrounds consume these. */
export function attachSheen(dock: HTMLElement, opts: { reducedMotion?: boolean } = {}): () => void {
  if (opts.reducedMotion) return () => {};
  const move = (event: PointerEvent) => {
    // Read all geometry before writing styles, including buttons that wrap or change during a take.
    const layers = [dock, ...dock.querySelectorAll<HTMLElement>('.btn')].map(element => ({
      element, bounds: element.getBoundingClientRect(),
    }));
    for (const { element, bounds } of layers) {
      element.style.setProperty('--mx', `${event.clientX - bounds.left}px`);
      element.style.setProperty('--my', `${event.clientY - bounds.top}px`);
    }
  };
  dock.addEventListener('pointermove', move);
  return () => dock.removeEventListener('pointermove', move);
}
