// Switching the public link reloads the desktop window (the preload re-reads the tunnel URLs), which
// used to close the pairing panel and drop the user back on the prompter. The panel marks itself
// before the switch and reopens once after the reload. sessionStorage survives a reload of the same
// window and nothing else.

type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "pair:reopen";

export function markReopenPairing(store: KeyStore | undefined = safeSession()): void {
  try {
    store?.setItem(KEY, "1");
  } catch {
    /* storage blocked: the panel simply stays closed, as before */
  }
}

export function consumeReopenPairing(store: KeyStore | undefined = safeSession()): boolean {
  try {
    if (store?.getItem(KEY) !== "1") return false;
    store.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

function safeSession(): KeyStore | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}
