import { expect, it } from "vitest";
import { DICTIONARIES } from "@filow/core";
import { LOCAL_MODELS } from "./localModels";

// The catalogue holds no text: each model's name and description are dictionary keys, so they are
// translated with the rest of the interface (DUP4; the parity test covers every language).
it("names and describes every catalogue model in the dictionary", () => {
  const en = DICTIONARIES.en as Record<string, string>;
  const missing = LOCAL_MODELS.flatMap((m) => [`modelLabel.${m.name}`, `model.${m.name}`]).filter((k) => !en[k]);
  expect(missing).toEqual([]);
});
