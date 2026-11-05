import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { audioConstraints, getSelectedMic, listMicrophones, setSelectedMic } from "./micDevice";

const device = (deviceId: string, label: string, groupId: string, kind = "audioinput") => ({ deviceId, label, groupId, kind });
let devices: ReturnType<typeof device>[];
beforeEach(() => {
  devices = [device("default", "Predefinito - USB", "usb"), device("communications", "Comunicazioni - C920", "cam"),
    device("usb-id", "USB", "usb"), device("cam-id", "C920", "cam"), device("speaker", "Speakers", "usb", "audiooutput")];
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) });
  vi.stubGlobal("navigator", { mediaDevices: { enumerateDevices: vi.fn(async () => devices) } });
});
afterEach(() => vi.unstubAllGlobals());

describe("microphone device preferences", () => {
  it("lists real inputs and marks only the system default, not communications", async () => {
    expect(await listMicrophones()).toEqual([{ deviceId: "usb-id", label: "USB", isDefault: true }, { deviceId: "cam-id", label: "C920", isDefault: false }]);
  });
  it("does not guess a default from empty group IDs or permission-hidden entries", async () => {
    devices = [device("default", "", ""), device("", "", ""), device("cam", "", "")];
    expect(await listMicrophones()).toEqual([{ deviceId: "cam", label: "", isDefault: false }]);
    devices = [device("default", "Default - C920", ""), device("cam", "C920", "")];
    expect((await listMicrophones())[0].isDefault).toBe(true);
  });
  it("persists and clears the exact preference key", () => {
    expect(getSelectedMic()).toBeNull();
    setSelectedMic("cam-id");
    expect(localStorage.getItem("prefs:micDeviceId")).toBe("cam-id");
    expect(getSelectedMic()).toBe("cam-id");
    setSelectedMic(null);
    expect(getSelectedMic()).toBeNull();
  });
  it("preserves base constraints without mutating them and pins the saved real device", async () => {
    setSelectedMic("cam-id");
    const base = { channelCount: 1, echoCancellation: true, noiseSuppression: true };
    expect(await audioConstraints(base)).toEqual({ ...base, deviceId: { exact: "cam-id" } });
    expect(base).not.toHaveProperty("deviceId");
    setSelectedMic(null);
    expect(await audioConstraints(base)).toEqual(base);
  });
  it("rechecks unplug/replug at every open, falls back and logs, retaining the preference", async () => {
    setSelectedMic("cam-id");
    devices = devices.filter(d => d.deviceId !== "cam-id");
    const log = vi.fn();
    expect(await audioConstraints({ channelCount: 1, deviceId: "stale" }, log)).toEqual({ channelCount: 1 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("system default"));
    expect(getSelectedMic()).toBe("cam-id");
    devices.push(device("cam-id", "C920", "cam"));
    expect(await audioConstraints()).toEqual({ deviceId: { exact: "cam-id" } });
  });
  it("is safe without browser globals or when storage is denied", async () => {
    vi.stubGlobal("navigator", undefined);
    vi.stubGlobal("localStorage", undefined);
    expect(await listMicrophones()).toEqual([]);
    expect(getSelectedMic()).toBeNull();
    expect(() => setSelectedMic("cam")).not.toThrow();
    expect(await audioConstraints()).toEqual({});
  });
});
