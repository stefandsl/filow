// Content script, injected on demand into the deck tab (activeTab). Answers the panel's
// questions through the background worker and reports slide changes. Classic IIFE bundle.
import { pickAdapter, type SlideInfo } from "./adapters";

declare global {
  interface Window {
    __filow?: boolean;
  }
}

(() => {
  if (window.__filow) return; // injected twice
  window.__filow = true;

  let adapter = pickAdapter();
  let last = "";
  let timer: number | null = null;

  const current = (): SlideInfo => {
    adapter = pickAdapter(); // decks can swap frameworks after load (Slidev hydration)
    return adapter.current();
  };

  const report = () => {
    const info = current();
    const sig = `${info.index}|${info.title ?? ""}|${info.text.slice(0, 200)}`;
    if (sig === last) return;
    last = sig;
    chrome.runtime.sendMessage({ t: "slideChanged", info }).catch(() => undefined);
  };
  const debounced = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(report, 300);
  };

  window.addEventListener("hashchange", debounced);
  window.addEventListener("popstate", debounced);
  document.addEventListener("fullscreenchange", debounced);
  // reveal.js fires this on the document; cheap to listen for even when absent.
  document.addEventListener("slidechanged", debounced);
  new MutationObserver(debounced).observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ["class", "aria-hidden", "style", "data-index"] });

  chrome.runtime.onMessage.addListener((msg: { t: string }, _sender, sendResponse) => {
    switch (msg.t) {
      case "probe":
        sendResponse({ ok: true, info: current() });
        return;
      case "next":
        adapter.next();
        setTimeout(() => sendResponse({ ok: true, info: current() }), 350);
        return true;
      case "prev":
        adapter.prev();
        setTimeout(() => sendResponse({ ok: true, info: current() }), 350);
        return true;
      case "ping":
        sendResponse({ ok: true });
        return;
    }
    return;
  });

  report();
})();
