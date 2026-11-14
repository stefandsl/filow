// API floor: v0.9.0 introduced the think flag used by Filow. Model-specific floors remain separate.
const MIN_OLLAMA_VERSION = "0.9.0";
function runtimeState(version, minimum = MIN_OLLAMA_VERSION) {
  const match = typeof version === "string" && /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) return "unknown";
  const actual = match.slice(1, 4).map(Number);
  const required = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (actual[i] > required[i]) return "ready";
    if (actual[i] < required[i]) return "old";
  }
  return version.includes("-") ? "old" : "ready";
}
async function checkRuntime(base, headers = {}, signal, minimum = MIN_OLLAMA_VERSION) {
  try {
    const response = await fetch(`${base}/api/version`, { headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000) });
    if (!response.ok) return { state: "unreachable", version: "", minimum };
    const { version } = await response.json();
    return { state: runtimeState(version, minimum), version: typeof version === "string" ? version : "", minimum };
  } catch { return { state: "unreachable", version: "", minimum }; }
}
module.exports = { MIN_OLLAMA_VERSION, runtimeState, checkRuntime };
