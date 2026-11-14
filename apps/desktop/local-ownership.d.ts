export function canonical(name: string): string;
export function ownership(profile: string): {
  read(): { version: number; models: Record<string, unknown>; runtime: null | { state: string; platform: string; executable?: string } };
  beginModel(base: string, name: string, installed: Array<{ name: string; digest?: string }>): void;
  completeModel(base: string, name: string, digest: string): void;
  ownsModel(base: string, name: string, digest: string): boolean;
  forgetModel(base: string, name: string): void;
  beginRuntime(platform: string): void;
  completeRuntime(executable: string): void;
};
