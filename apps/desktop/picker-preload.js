// The region picker window only reports the rectangle the user dragged.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("picker", {
  /** The frozen screenshot the shell took before opening this window ({ dataUrl }). */
  frame: () => ipcRenderer.invoke("picker:frame"),
  done: (rect) => ipcRenderer.send("picker:done", rect),
  cancel: () => ipcRenderer.send("picker:cancel"),
});
