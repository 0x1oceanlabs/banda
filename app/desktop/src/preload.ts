/**
 * Gives the page its one bridge to the desktop (app/web/src/host.ts),
 * built from the table of its channels (ADR 0028). The extensions'
 * buttons stay written here: electron-chrome-extensions answers them on
 * channels of its own.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"
import { PARTITION } from "@banda/browser-pane/desktop"
import { type HostOf, type Leaf, mapTable } from "@banda/contract/bridge"
import { BRIDGE, type Host } from "@banda/web/host"

/** Calls `listener` with each value main tells on `name`; returns how to
 * stop. */
function listen(name: string, listener: (value: unknown) => void) {
  const heard = (_event: IpcRendererEvent, value: unknown) => listener(value)
  ipcRenderer.on(name, heard)
  return () => {
    ipcRenderer.removeListener(name, heard)
  }
}

/** A leaf, as the page calls it. */
function call({ dir, name }: Leaf) {
  switch (dir) {
    case "invoke":
      return (...args: unknown[]) => ipcRenderer.invoke(name, ...args)
    case "send":
      return (...args: unknown[]) => ipcRenderer.send(name, ...args)
    case "push":
      return (listener: (value: unknown) => void) => listen(name, listener)
  }
}

const banda = mapTable(BRIDGE, call) as HostOf<typeof BRIDGE>
const { key, ...browser } = banda.browser

// A key the desktop took from a browser page is pressed in the window, so
// Banda's actions and the browser Pane hear it as their own
// (@banda/browser-desktop).
key((pressed) => {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      ...pressed,
      bubbles: true,
      cancelable: true,
    })
  )
})

const host: Host = {
  ...banda,
  browser: {
    ...browser,
    actions: {
      ...browser.actions,
      // electron-chrome-extensions answers these itself.
      state: () => extensions("browserAction.getState"),
      click: (extensionId, tabId) =>
        extensions("browserAction.activate", {
          eventType: "click",
          extensionId,
          tabId,
          anchorRect: { x: 0, y: 0, width: 0, height: 0 },
        }),
      listen: (listener) => {
        const stop = listen("browserAction.update", () => listener())
        void extensions("browserAction.addObserver")
        return () => {
          stop()
          void extensions("browserAction.removeObserver")
        }
      },
    },
  },
}

contextBridge.exposeInMainWorld("banda", host)

/** Asks electron-chrome-extensions about the browser's profile. */
function extensions(name: string, ...args: unknown[]) {
  return ipcRenderer.invoke("crx-msg-remote", PARTITION, name, ...args)
}
