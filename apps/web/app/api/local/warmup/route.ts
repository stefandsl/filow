import { NextResponse } from "next/server";
import { warmClefLocal } from "@/lib/decide/clef";

export const dynamic = "force-dynamic";

/** Loads the local decision model into memory and pins it there (keep_alive -1). Harmless to repeat. */
export async function POST() {
  return NextResponse.json(await warmClefLocal());
}
