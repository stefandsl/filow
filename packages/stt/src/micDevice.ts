/** Device preferences only. Importing this module never requests microphone permission. */
const KEY = "prefs:micDeviceId";
export type Microphone = { deviceId: string; label: string; isDefault: boolean };

/**
 * Whether this PC has any audio input at all. Also right before the permission: the browser then
 * still lists each input, only without its id and name (which listMicrophones leaves out). Where the
 * browser cannot list devices at all (no navigator, or an insecure page) it cannot tell: true, so no
 * one is told to plug in a microphone they have.
 */
export async function hasMicrophone(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return true;
  return (await navigator.mediaDevices.enumerateDevices()).some(d => d.kind === "audioinput");
}

/** What a microphone picker shows: no input at all, inputs whose names need the permission, or named inputs. */
export function micPickerState(anyInput: boolean, devices: Microphone[]): "none" | "ask" | "ready" {
  if (!anyInput) return "none";
  return !devices.length || devices.some(d => !d.label) ? "ask" : "ready";
}

export async function listMicrophones(): Promise<Microphone[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "audioinput");
  const system = inputs.find(d => d.deviceId === "default");
  return inputs.filter(d => d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications")
    .map(d => ({ deviceId: d.deviceId, label: d.label,
      isDefault: !!system && (system.groupId ? system.groupId === d.groupId : !!d.label && system.label.endsWith(d.label)),
    }));
}

export function getSelectedMic(): string | null {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

export function setSelectedMic(id: string | null): void {
  try {
    if (id && id !== "default" && id !== "communications") localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch { /* Storage can be disabled by the host. */ }
}

/** Revalidate at each open; retain an unplugged preference so reconnecting restores it. */
export async function audioConstraints(
  base: MediaTrackConstraints = {},
  onFallback?: (line: string) => void,
): Promise<MediaTrackConstraints> {
  const { deviceId: _ignored, ...constraints } = base;
  const id = getSelectedMic();
  if (!id) return constraints;
  if ((await listMicrophones()).some(d => d.deviceId === id)) return { ...constraints, deviceId: { exact: id } };
  onFallback?.(MIC_UNAVAILABLE);
  return constraints;
}

const MIC_UNAVAILABLE = "Selected microphone is unavailable; using the system default.";

/**
 * Opens the microphone the user chose, or the system default when that one is gone: a saved
 * microphone that was unplugged is never an error (asked for by its exact id, the browser refuses
 * with OverconstrainedError and nothing is heard at all). Also when it goes between the check and the
 * open. `onFallback` is told once. Every other failure (refused, busy, no microphone) is thrown as it is.
 */
export async function openSelectedMic(base: MediaTrackConstraints = {}, onFallback?: (line: string) => void): Promise<MediaStream> {
  let told = false;
  const fallback = (line: string) => { if (!told) { told = true; onFallback?.(line); } };
  const audio = await audioConstraints(base, fallback);
  try {
    return await navigator.mediaDevices.getUserMedia({ audio });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (audio.deviceId === undefined || (name !== "OverconstrainedError" && name !== "NotFoundError")) throw err;
    fallback(MIC_UNAVAILABLE);
    const { deviceId: _gone, ...rest } = audio;
    return navigator.mediaDevices.getUserMedia({ audio: rest });
  }
}
