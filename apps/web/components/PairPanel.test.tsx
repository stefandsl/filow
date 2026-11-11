import { expect, it, vi } from "vitest";
import { announcePairing } from "./PairPanel";

// The phone link is started by the shell when the pairing panel opens (apps/desktop/main.js linkForPairing).
it("opening the pairing panel tells the shell once; a browser or an older shell is left alone", () => {
  const pairingOpened = vi.fn();
  announcePairing({ pairingOpened });
  expect(pairingOpened).toHaveBeenCalledTimes(1);
  expect(pairingOpened).toHaveBeenCalledWith();
  expect(() => { announcePairing(null); announcePairing({}); }).not.toThrow();
});
