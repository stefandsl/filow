// System notification (Windows toast, macOS banner, browser notification) for things the user should
// notice even when the app is behind the slides: Screen Sense starting or stopping. Never blocks.
export function notifyUser(title: string, body: string): void {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  const show = () => {
    try {
      new Notification(title, { body, silent: true, tag: "filow-screen" });
    } catch {
      /* no notification support in this context */
    }
  };
  if (Notification.permission === "granted") return show();
  if (Notification.permission === "default") {
    void Notification.requestPermission().then((p) => {
      if (p === "granted") show();
    });
  }
}
