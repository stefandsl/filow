import type { ReactNode } from "react";
export function ActionBar({start, mode, prev, next, overflow, transcriptToggle}: {
 start: ReactNode; mode: ReactNode; prev: ReactNode; next: ReactNode; overflow: ReactNode; transcriptToggle?: ReactNode;
}) {
 return <div className="action-bar"><div className="action-start">{start}{mode}</div>
   <div className="action-navigation"><span className="sidebar-only">{transcriptToggle}</span>{prev}{next}{overflow}</div></div>;
}
