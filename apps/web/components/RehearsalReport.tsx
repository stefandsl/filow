"use client";
// The rehearsal report shown after Stop (research item 1): made on this computer from the take;
// saved as Markdown or printed (the print dialog offers "Save as PDF").
import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { formatClock, rehearsalMarkdown, type I18nKey, type Lang, type RehearsalReport as Report } from "@filow/core";
import { useLang, useT } from "@filow/ui";
import { Dialog } from "./prompter/Dialog";
import { sectionLabel } from "./prompter/sectionLabel";
import { downloadMarkdown, printReport } from "./RehearsalExport";
import "./Rehearsal.css";

const OUTCOMES = ["covered", "late", "missed", "notReached"] as const;

function ReportBody({ report: r, idPrefix }: { report: Report; idPrefix: string }) {
  const t = useT();
  const lang = useLang();
  const when = new Date(r.startedAt).toLocaleString(lang);
  const pace = r.pace.value === null ? t("report.paceShort") : t(r.pace.unit === "cpm" ? "report.cpm" : "report.wpm", { n: r.pace.value });
  const over = r.talkTargetMs !== null ? r.durationMs - r.talkTargetMs : null;
  return (
    <div className="report-body">
      <p className="hint">{t("report.madeHere", { when })}</p>
      <section aria-labelledby={`${idPrefix}-next`}>
        <h2 id={`${idPrefix}-next`}>{t("report.nextSteps")}</h2>
        <ul className="report-tips">
          {r.suggestions.map((s, i) => <li key={i}>{t(s.key, s.vars)}</li>)}
        </ul>
      </section>
      <section aria-labelledby={`${idPrefix}-glance`}>
        <h2 id={`${idPrefix}-glance`}>{t("report.overview")}</h2>
        <dl className="report-tiles">
          <div>
            <dt>{t("report.length")}</dt>
            <dd><strong>{formatClock(r.durationMs)}</strong>{r.talkTargetMs !== null && <span> {t("timer.of", { target: formatClock(r.talkTargetMs) })}</span>}</dd>
            {over !== null && Math.abs(over) >= 30_000 && <dd className="hint">{over > 0 ? t("timer.over", { t: formatClock(over) }) : t("timer.left", { t: formatClock(-over) })}</dd>}
          </div>
          <div>
            <dt>{t("report.pace")}</dt>
            <dd><strong>{pace}</strong></dd>
            {r.pace.band && <dd className="hint">{t(`report.band.${r.pace.band}` as I18nKey)}, {t("report.paceRange", { lo: r.pace.range[0], hi: r.pace.range[1] })}</dd>}
          </div>
          <div>
            <dt>{t("report.fillers")}</dt>
            <dd><strong>{r.fillers.total}</strong></dd>
            {r.fillers.top.length > 0 && <dd className="hint">{r.fillers.top.map((f) => `"${f.label}" ${f.count}`).join(", ")}</dd>}
          </div>
          <div>
            <dt>{t("report.pauses")}</dt>
            <dd><strong>{r.pauses.count}</strong></dd>
            {r.pauses.count > 0 && <dd className="hint">{t("report.longest")} {Math.round(r.pauses.longestMs / 1000)} s</dd>}
          </div>
        </dl>
      </section>
      <section aria-labelledby={`${idPrefix}-sections`}>
        <h2 id={`${idPrefix}-sections`}>{t("report.sections")}</h2>
        <div className="report-table-wrap">
          <table className="report-table">
            <thead>
              <tr><th scope="col">{t("report.section")}</th><th scope="col">{t("report.time")}</th><th scope="col">{t("report.target")}</th><th scope="col">{t("report.pointsCol")}</th></tr>
            </thead>
            <tbody>
              {r.sections.map((s) => {
                const extra = s.targetMs !== null && s.visited ? s.spentMs - s.targetMs : null;
                const pts = OUTCOMES.filter((k) => s.outcomes[k]).map((k) => `${s.outcomes[k]} ${t(`report.outcome.${k}` as I18nKey)}`).join(", ");
                return (
                  <tr key={s.idx}>
                    <th scope="row">{sectionLabel(s.title).title}</th>
                    <td>{s.visited ? formatClock(s.spentMs) : t("report.notShown")}{extra !== null && extra >= 30_000 && <span className="hint"> (+{formatClock(extra)})</span>}</td>
                    <td>{s.targetMs !== null ? formatClock(s.targetMs) : "-"}</td>
                    <td>{pts || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {(["missed", "late", "notReached"] as const).map((k) => {
        const list = r.points.filter((p) => p.outcome === k);
        if (!list.length) return null;
        return (
          <section key={k} aria-labelledby={`${idPrefix}-list-${k}`}>
            <h2 id={`${idPrefix}-list-${k}`}>{t(`report.list.${k}` as I18nKey)}</h2>
            <ul className="report-points">{list.map((p) => <li key={p.id}>{p.text}</li>)}</ul>
          </section>
        );
      })}
      <p className="hint report-limits">{t("report.limits")}</p>
    </div>
  );
}

export function RehearsalReport({ report, notes, onClose, returnFocusRef }: {
  report: Report;
  /** the live screen notes of the take, as Markdown, appended to the saved file */
  notes?: string;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const lang = useLang() as Lang;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <>
      <Dialog title={t("report.title")} onClose={onClose} className="rehearsal-report" returnFocusRef={returnFocusRef}>
        <ReportBody report={report} idPrefix="report" />
        <div className="controls report-actions">
          <button type="button" className="btn primary" onClick={() => downloadMarkdown(rehearsalMarkdown(report, lang, notes), "filow-rehearsal")}>{t("report.saveMd")}</button>
          <button type="button" className="btn" onClick={printReport}>{t("report.print")}</button>
          <button type="button" className="btn" onClick={onClose}>{t("report.close")}</button>
        </div>
      </Dialog>
      {mounted && createPortal(
        <div className="rehearsal-print" aria-hidden="true">
          <h1>{t("report.title")}</h1>
          <ReportBody report={report} idPrefix="report-print" />
        </div>,
        document.body,
      )}
    </>
  );
}
