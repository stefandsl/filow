/** Measure content, never the animated container, so updates cannot feed back into the observer. */
export function observeBubbleSize(inner: HTMLElement, outer: HTMLElement, Observer = ResizeObserver) {
  const size = () => {
    outer.style.width = `${inner.offsetWidth + 28}px`;
    outer.style.height = `${inner.offsetHeight + 20}px`;
  };
  size();
  const observer = new Observer(size);
  observer.observe(inner);
  return () => observer.disconnect();
}
