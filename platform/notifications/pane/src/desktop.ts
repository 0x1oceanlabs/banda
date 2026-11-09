/**
 * The desktop's notifications, on `window.banda.notifications`
 * (client/desktop/src/preload.ts): the window's table takes the bridge in
 * (client/desktop/src/bridge.ts), and the module's desktop part answers it
 * (`@banda/notifications-desktop`); none outside Banda's desktop window.
 */
import { type HostOf, invoke, push, send } from "@banda/contract/bridge"

/** A system notification the module asks the desktop for (ADR 0011,
 * decision 3). */
export type Notice = {
  /** One per thing: a new notice of it replaces the last. */
  key: string
  title: string
  body?: string
  /** The mark in the call's state, as a PNG data URL. */
  icon?: string
  /** The words of its button. */
  answer: string
  /** It stays until taken back, as one that waits for the Person does. */
  lasts: boolean
  /** It makes no sound where the desktop's notices make their own
   * (`sounds`): what told it asked for none, or `[sound]` gives its call
   * none (`silentWith`). */
  silent?: boolean
}

/** The desktop's notifications and its quiet. */
export const NOTIFY_BRIDGE = {
  /** Shows a notice; one of the same key goes first. */
  show: send<[notice: Notice]>(),
  /** Takes back the notice of `key`, if it still shows. */
  withdraw: send<[key: string]>(),
  /**
   * Calls `listener` with a notice's key when the Person clicks it; the
   * window is in front by then. Returns how to stop.
   */
  listen: push<string>(),
  /** Whether the desktop is quiet now: its Do Not Disturb is on. */
  quiet: invoke<[], boolean>(),
  /**
   * Whether a notice the desktop shows makes the desktop's own sound, as
   * Windows' do: Banda plays none of its own with one then, and Windows'
   * Do Not Disturb, which Banda cannot read, silences it (ADR 0090,
   * decision 7).
   */
  sounds: invoke<[], boolean>(),
}

export type Desktop = HostOf<typeof NOTIFY_BRIDGE>

/** The desktop's notifications; none outside Banda's desktop window. */
export function desktopOf(): Desktop | undefined {
  if (typeof window === "undefined") return undefined
  return (window as unknown as { banda?: { notifications?: Desktop } }).banda
    ?.notifications
}
