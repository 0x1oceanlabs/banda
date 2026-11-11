// Written by banda's tests from the list of Apps (engine/src/apps.rs): do not edit.
import type { ProjectsMethods } from "./ProjectsMethods"
import type { WindowMethods } from "./WindowMethods"
import type { AgentsMethods } from "./agents/AgentsMethods"
import type { BrowserMethods } from "./browser/BrowserMethods"
import type { FilesMethods } from "./files/FilesMethods"
import type { GitMethods } from "./git/GitMethods"
import type { PullsMethods } from "./pulls/PullsMethods"
import type { TerminalMethods } from "./terminal/TerminalMethods"
import type { BytesMethods } from "./bytes/BytesMethods"
import type { HarnessesMethods } from "./harnesses/HarnessesMethods"
import type { KeysMethods } from "./keys/KeysMethods"
import type { MachinesMethods } from "./machines/MachinesMethods"
import type { ProblemsMethods } from "./problems/ProblemsMethods"
import type { SharingMethods } from "./sharing/SharingMethods"
import type { UpdatesMethods } from "./updates/UpdatesMethods"
import type { WorkspacesMethods } from "./workspaces/WorkspacesMethods"

/** A part's methods under its prefix: `send` becomes `agents.send`. */
type Prefixed<P extends string, M> = {
  [K in keyof M & string as `${P}.${K}`]: M[K]
}

/** Every method of the engine: the kernel's own, then each engine
 * part's, in the list of Apps (ADR 0062, decision 11). */
export type Methods = Prefixed<"projects", ProjectsMethods> &
  Prefixed<"window", WindowMethods> &
  Prefixed<"agents", AgentsMethods> &
  Prefixed<"browser", BrowserMethods> &
  Prefixed<"files", FilesMethods> &
  Prefixed<"git", GitMethods> &
  Prefixed<"pulls", PullsMethods> &
  Prefixed<"terminal", TerminalMethods> &
  Prefixed<"bytes", BytesMethods> &
  Prefixed<"harnesses", HarnessesMethods> &
  Prefixed<"keys", KeysMethods> &
  Prefixed<"machines", MachinesMethods> &
  Prefixed<"problems", ProblemsMethods> &
  Prefixed<"sharing", SharingMethods> &
  Prefixed<"updates", UpdatesMethods> &
  Prefixed<"workspaces", WorkspacesMethods>
