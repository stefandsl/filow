import { NextResponse } from "next/server";
import type { ImportResponse } from "@filow/core";
import { requireEngine } from "@/lib/engineAuth";
import { importFile } from "@/lib/import/parse";

export const runtime = "nodejs";

const MAX_BYTES = 40 * 1024 * 1024;

/**
 * Document import (ARCHITECTURE.md §6.6): multipart form with one `file` field.
 * Returns the script text (script.md format) and the parsed Script; the caller
 * decides whether to save it with PUT /api/script. Engine-only. Nothing is kept
 * on the server. Scanned PDF pages are reported in `warnings`, not OCR'd (§6.7).
 */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form data with a `file` field" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "`file` is required" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "file too large (40 MB max)" }, { status: 413 });
  try {
    const out = await importFile(file.name, file.type, new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json<ImportResponse>(out);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 422 });
  }
}
