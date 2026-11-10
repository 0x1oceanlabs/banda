/**
 * What a module's part in the window's main process may use of main
 * (ADR 0028, decision 4): Banda's window, the look, the settings and the
 * engine as services, which main gives as layers; the dialogs over the
 * window; the errors main's effects fail with; the bridge's answers and
 * `tellPage`; the relay of the byte host, `app://files`, and the sandbox
 * host, `app://preview`, to the engine (ADR 0073, decision 5; ADR 0106,
 * decision 6).
 * Written in Effect, as main is (ADR 0020).
 */
export { confirm, pickFolder, pickSave, type Ask } from "./dialog"
export { Engine } from "./engine"
export type { Asked, DesktopModule, Served } from "./module"
export { Broke, NotFromPage, Refused } from "./errors"
export { askedOf, namedBy, relay } from "./files"
export { type Answer, type Answers, none, serve, tellPage, text } from "./ipc"
export { Look } from "./look"
export { onThisMachine, onThisMachineOn } from "./machine"
export { Settings } from "./settings"
export { writeWhole, writeWholeFrom, writeWholeIf } from "./whole"
export { Window } from "./window"
