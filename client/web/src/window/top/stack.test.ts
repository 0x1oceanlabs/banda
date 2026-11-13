// @vitest-environment happy-dom
/**
 * The Top layer's one stack (ADR 0110, step 3): which part is on top,
 * what Esc takes away, and where the keys go back.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { type Shown, Stack } from "./stack"

let stack: Stack
let stop: () => void

/** An element in the page that can take the focus. */
function put(
  into: Element,
  tag: string,
  attributes: Record<string, string> = {}
): HTMLElement {
  const element = document.createElement(tag)
  element.tabIndex = -1
  for (const [name, value] of Object.entries(attributes))
    element.setAttribute(name, value)
  into.append(element)
  return element
}

/** The Pane in front: its tile, and the message box in it. */
function pane() {
  const tile = put(document.body, "section", {
    "data-tile": "t1",
    "data-focused": "true",
  })
  return { tile, message: put(tile, "div", { role: "textbox" }) }
}

/** A part of the Top layer on the page and on the stack, with the focus
 * in it when it takes the keys, as each takes them as it comes. */
function show(
  part: string,
  {
    layer = "top",
    keys = true,
    closes = true,
  }: Partial<Shown> & {
    closes?: boolean
  } = {}
) {
  const root = put(document.body, "div", { "data-top": part })
  const close = vi.fn()
  const hide = stack.show({ part, layer, keys, ...(closes && { close }) })
  if (keys) root.focus()
  return {
    root,
    close,
    // Gone from the stack, then from the page, as a part that fades is.
    hide,
    // Gone from the page first, as the Sheet is.
    drop: () => {
      root.remove()
      hide()
    },
  }
}

const esc = (on: EventTarget = document.body, init: KeyboardEventInit = {}) =>
  on.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
      ...init,
    })
  )

beforeEach(() => {
  stack = new Stack()
  stop = stack.follow()
})

afterEach(() => {
  stop()
  document.body.replaceChildren()
})

test("the part on top is the one on the highest layer, and on one layer the last that came", () => {
  expect(stack.onTop()).toBeUndefined()
  const sheet = show("sheet", { layer: "sheet" })
  show("drawer", { layer: "drawer" })
  show("peek", { layer: "peek", keys: false })
  expect(stack.onTop()?.part).toBe("sheet")
  show("menu")
  const asks = show("quit")
  expect(stack.onTop()?.part).toBe("quit")
  asks.hide()
  expect(stack.onTop()?.part).toBe("menu")
  sheet.hide()
  expect(stack.onTop()?.part).toBe("menu")
})

test("Esc takes away the part on top, one for each Esc: a menu over the Sheet over the Drawer goes first, then the Sheet, then the Drawer", () => {
  const drawer = show("drawer", { layer: "drawer" })
  const sheet = show("sheet", { layer: "sheet" })
  // A dialog of Banda UI closes on its own Esc and stops it: the stack
  // leaves what is under it alone, even were it to hear one.
  const menu = show("menu", { closes: false })
  esc()
  expect(sheet.close).not.toHaveBeenCalled()
  expect(drawer.close).not.toHaveBeenCalled()
  menu.hide()

  esc()
  expect(sheet.close).toHaveBeenCalledTimes(1)
  expect(drawer.close).not.toHaveBeenCalled()
  sheet.drop()

  esc()
  expect(drawer.close).toHaveBeenCalledTimes(1)
  drawer.hide()

  // With nothing over the Panes, an Esc is nobody's here.
  expect(esc()).toBe(true)
})

test("an Esc is taken wherever the focus is, and so that nothing after the stack acts on it", () => {
  const { message } = pane()
  const peek = show("peek", { layer: "peek", keys: false })
  message.focus()
  expect(esc(message)).toBe(false)
  expect(peek.close).toHaveBeenCalledTimes(1)
})

test("an Esc something keeps for itself never reaches the stack: a field stops it, and an input method composes with it", () => {
  const { message } = pane()
  const drawer = show("drawer", { layer: "drawer" })
  // A find bar, a menu of the composer, a Pane's own key: each stops it.
  const find = put(drawer.root, "input")
  find.addEventListener("keydown", (event) => event.stopPropagation())
  esc(find)
  expect(drawer.close).not.toHaveBeenCalled()
  esc(message, { isComposing: true })
  expect(drawer.close).not.toHaveBeenCalled()
  // The message box prevents every Esc and keeps none: the Drawer lifts.
  const box = put(drawer.root, "div", { role: "textbox" })
  box.addEventListener("keydown", (event) => event.preventDefault())
  esc(box)
  expect(drawer.close).toHaveBeenCalledTimes(1)
})

test("any other key is not the stack's", () => {
  const sheet = show("sheet", { layer: "sheet" })
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
  )
  expect(sheet.close).not.toHaveBeenCalled()
})

test("as a part goes, the keys go back to the message box they were in", () => {
  const { message } = pane()
  message.focus()
  const sheet = show("sheet", { layer: "sheet" })
  expect(document.activeElement).toBe(sheet.root)
  sheet.drop()
  expect(document.activeElement).toBe(message)
})

test("a button pressed on the way, as the sidebar's gear, is not where the keys were", () => {
  const { message } = pane()
  message.focus()
  const sidebar = put(document.body, "aside", { "data-sidebar": "" })
  put(sidebar, "button").focus()
  show("sheet", { layer: "sheet" }).drop()
  expect(document.activeElement).toBe(message)
})

test("a field of the Sidebar is a place the keys stay", () => {
  pane().message.focus()
  const sidebar = put(document.body, "aside", { "data-sidebar": "" })
  const search = put(sidebar, "input")
  search.focus()
  show("menu", { closes: false }).hide()
  expect(document.activeElement).toBe(search)
})

test("with the place gone, the keys go to the tile of the Pane in front; with no Pane, they stay in the part as it fades", () => {
  const { tile, message } = pane()
  message.focus()
  const sheet = show("sheet", { layer: "sheet" })
  message.remove()
  sheet.drop()
  expect(document.activeElement).toBe(tile)

  // A tile under the dropped Drawer, on a workspace out of view, or out
  // of focus is not the Pane in front.
  tile.remove()
  put(document.body, "div", { inert: "" }).append(
    put(document.body, "section", { "data-tile": "t2", "data-focused": "true" })
  )
  put(document.body, "section", { "data-tile": "t3", "data-focused": "false" })
  const menu = show("menu", { closes: false })
  const field = put(menu.root, "input")
  field.focus()
  field.remove()
  menu.hide()
  expect(document.activeElement).toBe(menu.root)
})

test("the keys go back to the level now on top: a field of the Sheet under the menu, then the Pane", () => {
  const { message } = pane()
  message.focus()
  const sheet = show("sheet", { layer: "sheet" })
  const search = put(sheet.root, "input")
  search.focus()
  const menu = show("menu", { closes: false })
  put(menu.root, "input").focus()
  menu.hide()
  expect(document.activeElement).toBe(search)
  menu.root.remove()
  // The field gone, the Sheet itself has them.
  const again = show("menu", { closes: false })
  search.remove()
  again.hide()
  expect(document.activeElement).toBe(sheet.root)
  sheet.drop()
  expect(document.activeElement).toBe(message)
})

test("a part that goes as another comes gives the keys back first, so the next gives them to the same place", () => {
  const { message } = pane()
  message.focus()
  // The Banda menu's row opens the Settings: the menu goes, the Sheet
  // comes.
  const menu = show("menu", { closes: false })
  put(menu.root, "input").focus()
  menu.hide()
  const sheet = show("sheet", { layer: "sheet" })
  sheet.drop()
  expect(document.activeElement).toBe(message)
})

test("what took the focus meanwhile keeps it", () => {
  const { message } = pane()
  message.focus()
  const menu = show("menu", { closes: false })
  // A row opened a Pane, which took the focus.
  const opened = put(document.body, "section", { "data-tile": "t9" })
  opened.focus()
  menu.hide()
  expect(document.activeElement).toBe(opened)
})

test("Quick Look takes no keys: they stay where they were, and come back there when it goes with the focus in it", () => {
  const { message } = pane()
  message.focus()
  const peek = show("peek", { layer: "peek", keys: false })
  expect(document.activeElement).toBe(message)
  // A menu over it gives them back to the Pane, not to Quick Look.
  const menu = show("menu", { closes: false })
  menu.hide()
  expect(document.activeElement).toBe(message)
  // Pressed in, then closed: the focus is not left nowhere.
  put(peek.root, "button").focus()
  peek.drop()
  expect(document.activeElement).toBe(message)
})

test("under the open overview the tiles take no keys: it does", () => {
  pane().message.focus()
  const overview = put(document.body, "div", {
    "data-overview-state": "open",
  })
  overview.focus()
  show("sheet", { layer: "sheet" }).drop()
  expect(document.activeElement).toBe(overview)
})

test("the Drawer's own tile is the Drawer's, not the Pane in front", () => {
  const { message } = pane()
  message.focus()
  const drawer = show("drawer", { layer: "drawer" })
  const own = put(drawer.root, "section", {
    "data-tile": "d",
    "data-focused": "true",
  })
  const ask = put(own, "div", { role: "textbox" })
  ask.focus()
  // A menu over the Drawer gives them back to its message box.
  const menu = show("menu", { closes: false })
  menu.hide()
  expect(document.activeElement).toBe(ask)
  // Lifted, it stays on the page, inert; the workspace has them again.
  drawer.root.setAttribute("inert", "")
  drawer.hide()
  expect(document.activeElement).toBe(message)
})

test("the caret comes back where it was in a text edited in place, though a field took the page's selection meanwhile", () => {
  const { message } = pane()
  const text = document.createTextNode("half a message")
  message.append(text)
  message.focus()
  document.getSelection()?.collapse(text, 7)
  // The Banda menu's field takes the focus, and the selection with it.
  const menu = show("menu", { closes: false })
  put(menu.root, "input").focus()
  document.getSelection()?.removeAllRanges()
  menu.hide()
  expect(document.activeElement).toBe(message)
  const caret = document.getSelection()?.getRangeAt(0)
  expect([caret?.startContainer, caret?.startOffset]).toEqual([text, 7])
})
