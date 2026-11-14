import path from "node:path";
import { ownership, canonical } from "../../desktop/local-ownership";
export { canonical };
export const localOwnership = () => ownership(path.dirname(process.env.FILOW_SCRIPT || path.join(process.cwd(), "script.md")));
export async function modelInventory(base: string, signal?: AbortSignal): Promise<Array<{ name: string; digest: string }>> {
  const response = await fetch(`${base}/api/tags`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error("model_inventory_unavailable");
  const data = await response.json();
  if (!Array.isArray(data.models) || !data.models.every((m: { name?: unknown; digest?: unknown }) => typeof m.name === "string" && typeof m.digest === "string" && m.digest)) throw new Error("model_inventory_unavailable");
  return data.models;
}
