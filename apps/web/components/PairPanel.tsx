"use client";

import { useEffect, useState } from "react";
import type { SessionInfo } from "./useSession";

/** Shows the pairing code and a QR for the mirror URL. */
export function PairPanel({ info, status, error }: { info: SessionInfo | null; status: string; error: string | null }) {
  const [qr, setQr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!info) return;
    let alive = true;
    import("qrcode").then((QR) =>
      QR.toDataURL(info.mirrorUrl, { margin: 1, width: 220, color: { dark: "#f2f2f4", light: "#141418" } }).then((u) => {
        if (alive) setQr(u);
      }),
    );
    return () => {
      alive = false;
    };
  }, [info]);

  if (error) return <span className="chip err" title={error}>mirror off</span>;
  if (!info) return <span className="chip">session…</span>;

  return (
    <>
      <button className="chip code" onClick={() => setOpen((o) => !o)} title="Show pairing QR">
        pair {info.code} {status === "open" ? "●" : "○"}
      </button>
      {open && (
        <div className="modal-bg" onClick={() => setOpen(false)}>
          <div className="modal pairmodal" onClick={(e) => e.stopPropagation()}>
            <div className="eyebrow">Pair a phone</div>
            <div className="bigcode">{info.code}</div>
            {qr && <img src={qr} alt="QR code" width={220} height={220} />}
            <div className="hint">
              Scan, or open <code>{info.mirrorUrl}</code> on the phone.
              {status !== "open" && <> Relay status: {status}.</>}
            </div>
            <button className="btn" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
