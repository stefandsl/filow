import type { ReactNode } from "react";
export function StatusStrip({summary, details, stats}: {summary: ReactNode; details: ReactNode; stats: ReactNode}) {
 return <footer className="status-strip"><details><summary>{summary}</summary><div className="status-details">{details}</div></details><div className="status-stats">{stats}</div></footer>;
}
