import { useT } from "@filow/ui";
import { Icon } from "../icons";
export function Transcript({text, open, onToggle}: {text: string; open: boolean; onToggle(): void}) {
  const t = useT();
  return <section className="prompter-transcript">
    <button type="button" className="btn transcript-heading" aria-expanded={open} aria-controls="prompter-transcript-text" onClick={onToggle}><Icon name={open ? "chevronDown" : "chevronRight"} /> {t("footer.transcript")}</button>
    <p id="prompter-transcript-text" hidden={!open}>{text || t("state.waiting")}</p>
  </section>;
}
