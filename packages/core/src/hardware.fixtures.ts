// Probe outputs of real graphics cards, shared by the core, desktop and web detection tests
// (review T2 finding 4: the two sides are tested against the same machines).
import type { ProbeRunner } from "./hardware";

export const GB = 1024 ** 3;

/** Probe outputs of real machines, as nvidia-smi and the Windows adapter script print them. */
export const GPU_FIXTURES: Array<{ label: string; nvidia: string; windows: string; want: { kind: string; vramGb: number | null; ollama: boolean } }> = [
  { label: "RTX 3070 desktop", nvidia: "NVIDIA GeForce RTX 3070, 8192\n", windows: "", want: { kind: "discrete", vramGb: 8, ollama: true } },
  { label: "laptop with Intel UHD listed first and an RTX 4060", nvidia: "NVIDIA GeForce RTX 4060 Laptop GPU, 8188\n", windows: JSON.stringify([{ name: "Intel(R) UHD Graphics", bytes: 1 * GB }, { name: "NVIDIA GeForce RTX 4060 Laptop GPU", bytes: 8 * GB }]), want: { kind: "discrete", vramGb: 8, ollama: true } },
  { label: "AMD Ryzen 7 8845HS with Radeon 780M (8 GB carved out in the BIOS)", nvidia: "", windows: JSON.stringify({ name: "AMD Radeon(TM) 780M Graphics", bytes: 8 * GB }), want: { kind: "integrated", vramGb: null, ollama: false } },
  { label: "AMD APU, plain name", nvidia: "", windows: JSON.stringify([{ name: "AMD Radeon(TM) Graphics", bytes: 0.5 * GB }]), want: { kind: "integrated", vramGb: null, ollama: false } },
  { label: "Intel Arc A750 8 GB (Ollama cannot use it)", nvidia: "", windows: JSON.stringify([{ name: "Intel(R) Arc(TM) A750 Graphics", bytes: 8 * GB }]), want: { kind: "discrete", vramGb: 8, ollama: false } },
  { label: "Core Ultra built-in Arc", nvidia: "", windows: JSON.stringify([{ name: "Intel(R) Arc(TM) Graphics", bytes: 0.1 * GB }]), want: { kind: "integrated", vramGb: null, ollama: false } },
  { label: "Lunar Lake Arc 140V", nvidia: "", windows: JSON.stringify([{ name: "Intel(R) Arc(TM) 140V GPU (16GB)", bytes: 0.1 * GB }]), want: { kind: "integrated", vramGb: null, ollama: false } },
  { label: "Radeon RX 7800 XT 16 GB (on Ollama's ROCm list)", nvidia: "", windows: JSON.stringify([{ name: "AMD Radeon RX 7800 XT", bytes: 16 * GB }]), want: { kind: "discrete", vramGb: 16, ollama: true } },
  { label: "Radeon RX 6600 8 GB (not on the list)", nvidia: "", windows: JSON.stringify([{ name: "AMD Radeon RX 6600", bytes: 8 * GB }]), want: { kind: "discrete", vramGb: 8, ollama: false } },
  { label: "Intel UHD 620 office laptop", nvidia: "", windows: JSON.stringify([{ name: "Intel(R) UHD Graphics 620", bytes: 1 * GB }]), want: { kind: "integrated", vramGb: null, ollama: false } },
  { label: "nothing found", nvidia: "", windows: "", want: { kind: "none", vramGb: null, ollama: false } },
];

/** A probe runner that answers like the fixture machine. */
export const fixtureRunner = (f: { nvidia: string; windows: string }): ProbeRunner => async (cmd) => (cmd === "nvidia-smi" ? f.nvidia : cmd === "powershell.exe" ? f.windows : "");
