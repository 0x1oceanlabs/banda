/** What the core's hosts tests stand on: a Project, arc live and away, a
 * desktop the test tells, and a WebSocket the test drives. */
import type { ProjectSummary } from "@banda/contract"
import { vi } from "vitest"
import type { HostState } from "./device"
import type { HostsDevice } from "./hosts"

/** Project `id`, trusted and in its own folder, with `more`. */
export const project = (id: string, more: Partial<ProjectSummary> = {}) =>
  ({
    id,
    name: id,
    folder: `/${id}`,
    pinned: false,
    archived: false,
    sees_others: false,
    sign: { kind: "letters", text: "W", picked: false },
    trusted: true,
    scratch: false,
    missing: false,
    ...more,
  }) satisfies ProjectSummary

/** arc, live, on this window's own build. */
export const live = {
  name: "arc",
  ssh: "arc",
  state: "live",
  build: "abc123",
  version: "0.1.0-dev.421",
  own: { build: "abc123", version: "0.1.0-dev.421" },
} satisfies HostState

/** arc, away. */
export const away = {
  name: "arc",
  ssh: "arc",
  state: "away",
  why: "ssh ended",
} satisfies HostState

/** A desktop whose hosts the test tells, and whose engines it answers. */
export function desktop() {
  let tell: (hosts: HostState[]) => void = () => undefined
  const device = {
    follow: (take: (hosts: HostState[]) => void) => {
      tell = take
      return () => undefined
    },
    engine: vi.fn(async (name: string) => ({
      url: `ws://127.0.0.1:1/${name}`,
      secret: "s3cr3t",
    })),
    start: vi.fn(),
  } satisfies HostsDevice
  return { device, tell: (hosts: HostState[]) => tell(hosts) }
}

/** A WebSocket that only notes where it was opened to and what was sent
 * on it, and closes when the test says. */
export class Socket {
  static opened: Socket[] = []
  onopen?: () => void
  onmessage?: (message: { data: string }) => void
  onclose?: () => void
  readonly url: string
  readonly sent: { type: string; id: number; method?: string }[] = []
  constructor(url: string) {
    this.url = url
    Socket.opened.push(this)
  }
  send(frame: string) {
    this.sent.push(JSON.parse(frame))
  }
  close() {
    this.onclose?.()
  }
  /** Says `frame` to the page. */
  say(frame: object) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
}
