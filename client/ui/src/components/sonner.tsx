import type { ComponentProps, CSSProperties } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { toast } from "sonner"
import { useDark } from "../hooks/use-dark"

export { toast }
export type { ExternalToast, ToastT } from "sonner"

/** Sonner's own key to reach the toasts, `Alt+T`, is off: the Person's
 * keys are keys.toml's. Its region's name then is only this. */
const NO_KEY: string[] = []

const TOKENS = {
  "--normal-bg": "var(--color-popover)",
  "--normal-text": "var(--color-popover-foreground)",
  "--normal-border": "var(--color-border)",
  "--border-radius": "var(--card-radius)",
} as CSSProperties

/** The edge says each toast's kind at a glance, as the Mark's colours do:
 * an error is `failed`'s, a warning `asking`'s. Sonner's own rules
 * outrank a class, hence the `!`. */
const OPTIONS: ToasterProps["toastOptions"] = {
  classNames: {
    toast: "border-l-4! text-left",
    default: "border-l-foreground!",
    warning: "border-l-attention!",
    error: "border-l-destructive!",
    title: "truncate text-sm",
    description: "text-xs text-muted-foreground!",
  },
}

/** Where the toasts stand: at the window's top right, below the bar
 * (ADR 0011, decision 2). */
const UNDER_BAR = { top: "calc(var(--bar-height) + 0.5rem)", right: "0.5rem" }

/**
 * shadcn's toaster, Sonner, in Banda's tokens (ADR 0048): the card is a
 * popover's, light or dark as the look is, below the bar.
 */
export function Toaster(props: ComponentProps<typeof Sonner>) {
  const dark = useDark()
  return (
    <Sonner
      theme={dark ? "dark" : "light"}
      position="top-right"
      offset={UNDER_BAR}
      hotkey={NO_KEY}
      customAriaLabel="Notifications"
      style={TOKENS}
      toastOptions={OPTIONS}
      {...props}
    />
  )
}
