// A model download's label (issue #4): one localized phrase and one number for the whole model, never a
// file name. The number sits in a box of fixed width with tabular figures, so the button or chip keeps
// its width while the percent changes (9% -> 10% -> 100%).
export function DownloadLabel({ label, percent }: { label: string; percent: number | null }) {
  return (
    <span className="dl-label">
      {label} <span className="dl-pct">{percent === null ? "" : `${percent}%`}</span>
    </span>
  );
}
