import type { ReactNode } from "react";
export function ActionBar({label, start, mode, prev, next, overflow, transcriptToggle, warning}: {
 label: string; start: ReactNode; mode: ReactNode; prev: ReactNode; next: ReactNode; overflow: ReactNode; transcriptToggle?: ReactNode; warning?: ReactNode;
}) {
 return <div className="action-bar" role="region" aria-label={label}>{warning}<div className="action-start">{start}{mode}</div>
   <div className="action-navigation"><span className="transcript-toggle">{transcriptToggle}</span>{prev}{next}{overflow}</div></div>;
}
