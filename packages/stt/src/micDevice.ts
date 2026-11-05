/** Device preferences only. Importing this module never requests microphone permission. */
const KEY = "prefs:micDeviceId";
export type Microphone = { deviceId: string; label: string; isDefault: boolean };

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
  onFallback?.("Selected microphone is unavailable; using the system default.");
  return constraints;
}
