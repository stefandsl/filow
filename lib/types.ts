export type Bullet = {
  id: string;
  text: string;
};

export type Section = {
  id: string;
  title: string;
  bullets: Bullet[];
};

export type Script = {
  sections: Section[];
};

export type BulletStatus = "waiting" | "started" | "missed";

export type BulletState = {
  status: BulletStatus;
  confidence: number; // 0..1, last reported by the decision model
  startedAt?: number;
};

export type Decision = {
  id: string;
  started: boolean;
  confidence: number;
};

export type DecideRequest = {
  transcript: string;
  bullets: Bullet[];
  sectionTitle: string;
};

export type DecideResponse = {
  decisions: Decision[];
  latencyMs: number;
  cost: number; // USD, 0 when the provider does not report it
  model: string;
};

export type SttBackendId = "browser" | "elevenlabs" | "openai";

export type SttStatus = {
  elevenlabs: boolean;
  openai: boolean;
};
