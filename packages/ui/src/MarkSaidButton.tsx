import { Icon } from "../../../apps/web/components/icons";

/**
 * The visible "mark as said" control of a point, and its undo. It is a sibling of the point's row,
 * never inside it (the row is a button of its own: one tap there says "I am here"). A point not said
 * shows an outlined check; a said point a filled check that turns into an undo arrow on hover and
 * keyboard focus. `short` is the visible word where the layout has room (globals.css): it is part of
 * `label`, the accessible name and tooltip. `describedBy` names the point's text.
 */
export function MarkSaidButton({ done, label, short, describedBy, onToggle }: { done: boolean; label: string; short?: string; describedBy?: string; onToggle(): void }) {
  return (
    <button type="button" className={`point-mark${done ? " done" : ""}`} aria-label={label} title={label} aria-describedby={describedBy} onClick={() => onToggle()}>
      <span className="point-mark-icon point-mark-check"><Icon name="check" /></span>
      {done && <span className="point-mark-icon point-mark-undo"><Icon name="undo" /></span>}
      {short && <span className="point-mark-label">{short}</span>}
    </button>
  );
}
