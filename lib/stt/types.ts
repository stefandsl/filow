import type { SttBackendId } from "@/lib/types";

export type TranscriptEvent = {
  /** Text that will not change again. Append it to the running transcript. */
  committed?: string;
  /** Interim text for the current segment. Replaces the previous partial. */
  partial?: string;
};

export type SttHandlers = {
  onTranscript: (e: TranscriptEvent) => void;
  onError: (message: string) => void;
  /** Fired once, when the backend is connected and listening. */
  onReady?: () => void;
};

export interface SttBackend {
  readonly id: SttBackendId;
  readonly label: string;
  start(handlers: SttHandlers): Promise<void>;
  stop(): void;
}
