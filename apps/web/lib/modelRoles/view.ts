// What Settings > Advanced shows for "Which model does each task", from GET /api/local/roles and the
// desktop app's speech list. Pure, so the choices offered are tested without a page.
import type { Pin } from "./store";
import { taskDef, type OllamaTaskId, type Unfit } from "./tasks";

export type RolesModel = { name: string; sizeBytes: number | null; vision: boolean; chat: boolean; clef: boolean };
export type RolesSource = { reachable: boolean; models: RolesModel[] };
export type RolesServer = RolesSource & { id: string; name: string; url: string; where: "this-pc" | "lan" | "internet"; warnings: Array<"plain" | "internet"> };
export type RolesFallback = "missing" | "unreachable" | "unfit" | "unagreed";
export type RolesData = {
  here: RolesSource & { url: string; elsewhere: string | null };
  servers: RolesServer[];
  pins: Partial<Record<string, Pin>>;
  tasks: Record<OllamaTaskId, { auto: string | null; now: { model: string; server: string | null } | null; pinned: boolean; fallback: RolesFallback | null }>;
};

/** One speech task as the desktop app reports it (apps/desktop/model-use.js speechRoles). */
export type SpeechRole = { auto: string | null; active: string | null; pin: string | null; note: "pinMissing" | "pinUnfit" | null; can: string[]; language: string };

/** One choice in a task's list: `value` is "source|model"; `unfit` greys it out with the reason. */
export type RoleOption = { value: string; source: string; model: string; label: string; unfit: Unfit | "language" | null };
export type RoleGroup = { source: string; serverName: string | null; reachable: boolean; options: RoleOption[] };

export const optionValue = (source: string, model: string) => `${source}|${model}`;
export function parseOption(value: string): { source: string; model: string } | null {
  const i = value.indexOf("|");
  return i > 0 ? { source: value.slice(0, i), model: value.slice(i + 1) } : null;
}

function unfitOf(task: OllamaTaskId, m: RolesModel): Unfit | null {
  const need = taskDef(task).need;
  if (need === "clef") return m.clef ? null : "clef";
  if (!m.chat) return "chat";
  if (need === "vision" && !m.vision) return "vision";
  return null;
}

/**
 * Every model on this PC and on each server, grouped by where it runs. A model that cannot do the
 * task stays in the list, greyed out with the reason, so the user sees why it is not offered.
 */
export function ollamaGroups(task: OllamaTaskId, data: RolesData): RoleGroup[] {
  const group = (source: string, serverName: string | null, s: RolesSource): RoleGroup => ({
    source,
    serverName,
    reachable: s.reachable,
    options: s.models.map((m) => ({ value: optionValue(source, m.name), source, model: m.name, label: m.name, unfit: unfitOf(task, m) })),
  });
  return [group("local", null, data.here), ...data.servers.map((s) => group(s.id, s.name, s))];
}

/** The speech models on disk, each usable for the task only when it can listen in the task's language. */
export function speechGroup(role: SpeechRole, models: Array<{ id: string; name: string; installed: boolean }>): RoleGroup {
  const options = models
    .filter((m) => m.id.startsWith("speech:") && m.installed)
    .map((m) => {
      const key = m.id.slice("speech:".length);
      return { value: optionValue("local", key), source: "local", model: key, label: m.name, unfit: role.can.includes(key) ? null : ("language" as const) };
    });
  return { source: "local", serverName: null, reachable: true, options };
}

/** The value the list shows: the pin (even one that is not there now: the note says why), else Automatic (""). */
export function selectedValue(pin: Pin | undefined | null): string {
  return pin ? optionValue(pin.source, pin.model) : "";
}

/** A pin the lists do not offer any more (deleted, or its server does not answer): still shown, as unavailable. */
export function missingPin(pin: Pin | undefined | null, groups: RoleGroup[]): boolean {
  if (!pin) return false;
  return !groups.some((g) => g.options.some((o) => o.value === optionValue(pin.source, pin.model)));
}
