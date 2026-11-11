import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";

export function containDialogTab(event: { key: string; shiftKey: boolean; preventDefault(): void }, active: Element | null, stops: HTMLElement[], dialog: HTMLElement) {
  if (event.key !== "Tab") return;
  const first = stops[0], last = stops[stops.length - 1];
  if (!first || !stops.includes(active as HTMLElement) || (event.shiftKey ? active === first : active === last)) {
    event.preventDefault();
    (event.shiftKey ? last ?? dialog : first ?? dialog).focus();
  }
}

export function openDialog(dialog: HTMLDialogElement, opener: HTMLElement | null) {
  // showModal supplies initial focus and an inert background.
  dialog.showModal();
  return () => {
    dialog.close();
    if (opener?.isConnected) opener.focus();
  };
}

export function Dialog({ title, onClose, children, className = "", returnFocusRef, heading = false }: {
  title: string;
  /** the title is the dialog's h1: for a dialog that is a document with h2 parts (the rehearsal report) */
  heading?: boolean;
  onClose(): void;
  children: ReactNode;
  className?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = returnFocusRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    return openDialog(dialog, opener);
  }, [returnFocusRef]);
  return <dialog ref={ref} tabIndex={-1} className="modal-bg accessible-dialog" aria-modal="true" aria-labelledby={titleId}
    onKeyDown={event => {
      const dialog = event.currentTarget;
      const stops = [...dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')]
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
      containDialogTab(event, document.activeElement, stops, dialog);
    }}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`modal ${className}`}>
      {heading ? <h1 className="dialog-title" id={titleId}>{title}</h1> : <div className="label" id={titleId}>{title}</div>}
      {children}
    </div>
  </dialog>;
}
