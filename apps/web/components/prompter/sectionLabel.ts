/** Optional script heading prefix, e.g. "Intro - What is a decision model?". */
export function sectionLabel(title: string) {
  const separator = title.indexOf(" - ");
  return separator > 0 ? { label: title.slice(0, separator), title: title.slice(separator + 3) } : { label: "", title };
}
