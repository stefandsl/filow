"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { t } from "@filow/core";
import { Wordmark } from "@filow/ui";
import { useUiLang } from "@/components/LangSwitch";
import { desktopBridge, type DesktopBridge } from "@/lib/sessionUrl";
import { okfText } from "@/lib/buddy/text";
import "./account.css";
type Account = NonNullable<DesktopBridge["account"]>;
type Status = Awaited<ReturnType<Account["status"]>>;
export default function AccountPage() {
  const [lang] = useUiLang();
  const tr = useCallback((key: Parameters<typeof t>[0]) => t(key, lang), [lang]);
  // What leaves this PC when signing in, and to whom (docs/okfilow/OUTBOUND.md, kind `account`).
  const outboundNotice = (who: string) => okfText(lang)("notice_account").replace("{who}", who);
  const [profile, setProfile] = useState<Status | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [checkoutClosed, setCheckoutClosed] = useState(false);
  const active = useRef(true);
  const refresh = useCallback(async () => {
    const result = await desktopBridge()?.account?.status();
    if (active.current) { setCheckoutClosed(result?.checkout === "billing_not_open"); setProfile(result ?? { configured: false, user: null, plan: "local", billing: false }); }
  }, []);
  useEffect(() => {
    active.current = true;
    void refresh().catch(() => { if (active.current) setMessage(tr("account.error")); });
    return () => { active.current = false; void desktopBridge()?.account?.cancel().catch(() => {}); };
  }, [refresh, tr]);
  useEffect(() => {
    if (!code) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const result = await desktopBridge()?.account?.poll();
        if (stopped) return;
        if (result?.state === "signed-in") { setCode(null); await refresh(); return; }
        if (result?.state !== "pending") { setCode(null); setMessage(tr("account.error")); return; }
      } catch { if (!stopped) setMessage(tr("account.error")); }
      if (!stopped) timer = setTimeout(() => void tick(), 5000);
    };
    timer = setTimeout(() => void tick(), 5000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [code, refresh, tr]);
  async function act(work: (account: Account) => Promise<void>) {
    const account = desktopBridge()?.account;
    if (!account) return;
    setBusy(true); setMessage("");
    try { await work(account); }
    catch { if (active.current) setMessage(tr("account.error")); }
    finally { if (active.current) setBusy(false); }
  }
  return <main className="account-page">
    <header><Wordmark height={30}/><Link className="btn" href="/settings/local">{tr("common.back")}</Link></header>
    <section className="account-card"><p className="account-eyebrow">FILOW</p><h1>{tr("account.title")}</h1><p className="account-intro">{tr("account.intro")}</p>
      {!profile ? <p role="status">{message || "…"}</p> : !profile.configured ? <p className="account-notice">{tr("account.unavailable")}</p> : profile.user ? <>
        <div className="account-profile"><strong>{profile.user.email}</strong><span>{tr(profile.plan === "pro" ? "account.paid" : "account.free")}</span></div>
        {profile.plan !== "pro" && checkoutClosed ? <p className="account-notice" role="status">{tr("account.billingNotOpen")}</p> : <button className="btn primary" disabled={busy || !profile.billing} onClick={() => void act(async a => { const result = await (profile.plan === "pro" ? a.portal() : a.checkout()); if (result?.state === "billing_not_open") { setCheckoutClosed(true); return; } setMessage(tr("account.billingPending")); })}>{tr(profile.plan === "pro" ? "account.manage" : "account.subscribe")}</button>}
        {!profile.billing && !checkoutClosed && <p className="account-notice">{tr("account.unavailable")}</p>}
        <div className="account-actions"><button className="btn" disabled={busy} onClick={() => void act(refresh)}>{tr("account.refresh")}</button><button className="btn" disabled={busy} onClick={() => void act(async a => { try { await a.signOut(); } finally { await refresh(); } })}>{tr("account.signOut")}</button></div>
      </> : code ? <div className="account-code"><p>{tr("account.approve")}</p><strong aria-live="polite">{code}</strong><button className="btn" disabled={busy} onClick={() => void act(async a => { await a.cancel(); setCode(null); })}>{tr("account.cancel")}</button></div> : <><p className="account-notice" data-testid="account-outbound">{outboundNotice(profile.service ?? "")}</p><button className="btn primary" disabled={busy} onClick={() => void act(async a => { const result = await a.begin(); if (result && active.current) setCode(result.userCode); })}>{tr("account.signIn")}</button></>}
      <p className="account-message" role="status">{message}</p>
      <Link href="/tour">{tr("tour.step")} →</Link>
    </section>
  </main>;
}
