import { NextResponse } from "next/server";
import { requireEngine } from "@/lib/engineAuth";
import { consentDenied } from "@/lib/buddy/outbound";
import { linkRecipient, ownHost, wikimediaRecipient } from "@/lib/buddy/media";
import { fromCommons, fromOwn } from "@/lib/buddy/mediaFetch";

export const dynamic = "force-dynamic";

/**
 * OK Filow's pictures on the screen (lib/buddy/media.ts). ?kind=gif|video&q=subject: a file about the
 * subject from Wikimedia Commons, after the user's yes for Wikimedia (only the subject's name is sent).
 * ?own=path-or-link: the user's own file on this PC, or a link they gave (a link to another computer
 * needs their yes for that site). Offline mode sends nothing to the web. Returns { item } or { item: null }.
 */
export async function GET(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const own = params.get("own")?.trim().slice(0, 1000) ?? "";
  const label = params.get("label")?.trim().slice(0, 40) || "Your file";
  try {
    if (own) {
      const host = /^[A-Za-z]:\\/.test(own) ? null : ownHost(own);
      if (host) {
        if (process.env.FILOW_OFFLINE === "1") return NextResponse.json({ item: null, reason: "offline" });
        const refused = consentDenied(req, "photo", linkRecipient(host));
        if (refused) return refused;
      }
      return NextResponse.json({ item: await fromOwn(own, label) });
    }
    const kind = params.get("kind");
    const q = params.get("q")?.trim().slice(0, 80) ?? "";
    if ((kind !== "gif" && kind !== "video") || q.length < 2) return NextResponse.json({ item: null });
    if (process.env.FILOW_OFFLINE === "1") return NextResponse.json({ item: null, reason: "offline" });
    const refused = consentDenied(req, "photo", wikimediaRecipient());
    if (refused) return refused;
    return NextResponse.json({ item: await fromCommons(kind, q) });
  } catch {
    return NextResponse.json({ item: null });
  }
}
