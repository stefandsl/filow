// Which of the user's own computers a "local" task reaches now (Settings > Advanced, model per task):
// what the notices and the "leaving this PC" signal must name. Only a choice that would really be
// used counts (lib/modelRoles/resolve.ts: there, able, answering, agreed, not offline).
import { serverRecipient, type Recipient } from "@/lib/buddy/outbound";
import { readRoles } from "./store";
import { taskTarget } from "./resolve";

export type ServerRecipients = { okfilow: Recipient | null; whiteboard: Recipient | null; decision: Recipient | null };

export async function serverRecipients(): Promise<ServerRecipients> {
  const roles = readRoles();
  const where = async (task: "okfilowAnswers" | "okfilowPointing" | "whiteboard" | "decision") => (roles.pins[task] ? (await taskTarget(task, null, roles)).server : null);
  const [answers, pointing, whiteboard, decision] = await Promise.all([where("okfilowAnswers"), where("okfilowPointing"), where("whiteboard"), where("decision")]);
  const okfilow = answers ?? pointing;
  return {
    okfilow: okfilow ? serverRecipient(okfilow) : null,
    whiteboard: whiteboard ? serverRecipient(whiteboard) : null,
    decision: decision ? serverRecipient(decision) : null,
  };
}
