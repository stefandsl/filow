export const MIN_OLLAMA_VERSION: string;
export function runtimeState(version: unknown, minimum?: string): "ready" | "old" | "unknown";
export function checkRuntime(base: string, headers?: Record<string, string>, signal?: AbortSignal, minimum?: string): Promise<{ state: "ready" | "old" | "unknown" | "unreachable"; version: string; minimum: string }>;
