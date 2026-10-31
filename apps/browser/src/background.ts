// Service worker: opens the side panel on the toolbar click, injects the content script into the
// active tab on request (activeTab + scripting, so no broad host permission), and captures the
// visible tab for the vision fallback. Frames are returned to the panel and never stored.
import browser from "webextension-polyfill";

type Msg =
  | { t: "attach" }
  | { t: "capture" }
  | { t: "toContent"; tabId?: number; msg: unknown }
  | { t: "activeTab" };

const api = chrome;

api.runtime.onInstalled.addListener(() => {
  // Chrome: clicking the toolbar icon opens the panel.
  api.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => undefined);
});

api.action?.onClicked.addListener((tab) => {
  if (api.sidePanel && tab.windowId !== undefined) api.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  else browser.sidebarAction?.open?.().catch(() => undefined);
});

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

api.runtime.onMessage.addListener((raw: Msg, _sender, sendResponse) => {
  (async () => {
    const tab = await activeTab();
    switch (raw.t) {
      case "activeTab":
        return { id: tab?.id, url: tab?.url, title: tab?.title };
      case "attach": {
        if (!tab?.id) return { ok: false, error: "no active tab" };
        try {
          await api.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
          return { ok: true, tabId: tab.id, url: tab.url };
        } catch (err) {
          return { ok: false, error: String((err as Error).message || err) };
        }
      }
      case "capture": {
        if (!tab?.windowId) return { ok: false, error: "no active tab" };
        try {
          const dataUrl = await api.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
          return { ok: true, dataUrl };
        } catch (err) {
          return { ok: false, error: String((err as Error).message || err) };
        }
      }
      case "toContent": {
        const id = raw.tabId ?? tab?.id;
        if (!id) return { ok: false, error: "no tab" };
        try {
          return await api.tabs.sendMessage(id, raw.msg);
        } catch (err) {
          return { ok: false, error: String((err as Error).message || err) };
        }
      }
    }
    return { ok: false, error: "unknown message" };
  })().then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }));
  return true; // async
});
