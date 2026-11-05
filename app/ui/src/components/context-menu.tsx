"use client"

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"
import { createContext, useContext, useRef, useState } from "react"
import { cn } from "../lib/utils"

type Later = (act: () => void) => void
type Menu = {
  later: Later
  /** A press on the trigger, before it moves the focus. */
  pressed: (event: React.PointerEvent) => void
}
const After = createContext<Menu>({ later: (act) => act(), pressed: () => {} })

/**
 * A menu a right click opens where the pointer is. Its items are the
 * dropdown menu's (`DropdownMenuItem`), so both menus look the same.
 *
 * As an item is chosen or Escape closes it, the focus goes back where it
 * was before the right click (ADR 0063, decision 3); a press elsewhere
 * leaves it where it went. An item's act that needs that focus, or moves
 * it, is given to {@link useAfterMenu}, to run once the menu has gone: it
 * holds the focus till then, and would take back what the act did.
 */
function ContextMenu({
  onOpenChange,
  onOpenChangeComplete,
  ...props
}: ContextMenuPrimitive.Root.Props) {
  const pressed = useRef<Element | null>(null)
  const before = useRef<HTMLElement | null>(null)
  const back = useRef(false)
  const next = useRef<() => void>(undefined)
  const [menu] = useState<Menu>(() => ({
    later: (act) => {
      next.current = act
    },
    // A right click (Ctrl+click on a Mac) moves the focus as it goes down.
    pressed: (event) => {
      const menuPress =
        event.button === 2 || (event.button === 0 && event.ctrlKey)
      pressed.current = menuPress ? document.activeElement : null
    },
  }))
  const focusBack = () => {
    const to = before.current
    if (back.current && to && document.activeElement !== to) to.focus()
  }
  // Once gone, the focus it held is nowhere; one an item moved, as to a
  // dialog it opened, stays.
  const focusLost = () => {
    const focused = document.activeElement
    if (!focused || focused === document.body) focusBack()
  }
  return (
    <After value={menu}>
      <ContextMenuPrimitive.Root
        data-slot="context-menu"
        onOpenChange={(open, details) => {
          if (open) {
            // Open again before the last one had gone: its act is due.
            const due = next.current
            next.current = undefined
            due?.()
            const focused = pressed.current ?? document.activeElement
            before.current = focused instanceof HTMLElement ? focused : null
          } else {
            back.current =
              details.reason === "item-press" || details.reason === "escape-key"
            // At once, so a key pressed as the menu fades goes there.
            focusBack()
          }
          pressed.current = null
          onOpenChange?.(open, details)
        }}
        onOpenChangeComplete={(open) => {
          if (!open) {
            focusLost()
            const act = next.current
            next.current = undefined
            before.current = null
            act?.()
          }
          onOpenChangeComplete?.(open)
        }}
        {...props}
      />
    </After>
  )
}

/** Runs a menu item's act once its {@link ContextMenu} has closed and
 * the focus is back. */
function useAfterMenu(): Later {
  return useContext(After).later
}

function ContextMenuTrigger({
  onPointerDownCapture,
  ...props
}: ContextMenuPrimitive.Trigger.Props) {
  const { pressed } = useContext(After)
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      onPointerDownCapture={(event) => {
        pressed(event)
        onPointerDownCapture?.(event)
      }}
      {...props}
    />
  )
}

function ContextMenuContent({
  className,
  ...props
}: ContextMenuPrimitive.Popup.Props) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner className="isolate z-50 outline-none">
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "z-50 max-h-(--available-height) min-w-40 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          // The menu puts the focus back itself (ContextMenu).
          finalFocus={false}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

export { ContextMenu, ContextMenuContent, ContextMenuTrigger, useAfterMenu }
