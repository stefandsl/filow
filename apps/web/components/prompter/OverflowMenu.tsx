import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useT } from "@filow/ui";
import { Icon } from "../icons";
export function handleMenuKey(event: { key: string; preventDefault(): void }, index: number, count: number, focus: (index: number) => void, close: (restore: boolean) => void) {
  if (event.key === "Escape") { event.preventDefault(); close(true); }
  else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && count) {
    event.preventDefault();
    focus(event.key === "Home" ? 0 : event.key === "End" ? count - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + count) % count);
  }
}
export function OverflowMenu({items}: {items: {id: string; label: string; onSelect(): void; icon?: ReactNode}[]}) {
  const t = useT(), id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const initial = useRef(0);
  const close = (restore: boolean) => { setOpen(false); if (restore) trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    buttons.current[initial.current]?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="overflow-menu" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <button type="button" className="btn" ref={trigger} aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-label={t("ctl.settings")}
      onClick={() => { initial.current = 0; setOpen(!open); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); initial.current = event.key === "ArrowUp" ? items.length - 1 : 0; setOpen(true); }
        else if (event.key === "Escape") close(true);
      }}><Icon name="more" /></button>
    <div id={id} role="menu" hidden={!open} aria-label={t("ctl.settings")} className="overflow-popover">
      {items.map((item,index) => <button type="button" role="menuitem" tabIndex={-1} key={item.id} ref={element => { buttons.current[index] = element; }}
        onKeyDown={event => handleMenuKey(event,index,items.length,i => buttons.current[i]?.focus(),close)}
        onClick={() => { close(true); item.onSelect(); }}>{item.icon}{item.label}</button>)}
    </div>
  </div>;
}
