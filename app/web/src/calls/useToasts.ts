import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { alive, released, type Toast } from "./toast"

/**
 * Toasts that go away by themselves, unless the pointer holds them (ADR
 * 0011, decision 2): the calls' and the Problems'.
 */
export function useToasts(): {
  toasts: readonly Toast[]
  setToasts: Dispatch<SetStateAction<readonly Toast[]>>
  /** The pointer holds the toasts, or lets them go. */
  hold: (holds: boolean) => void
} {
  const [toasts, setToasts] = useState<readonly Toast[]>([])
  const heldAt = useRef<number | undefined>(undefined)
  const hold = useCallback((holds: boolean) => {
    if (holds) {
      heldAt.current ??= Date.now()
      return
    }
    const from = heldAt.current
    heldAt.current = undefined
    if (from === undefined) return
    const now = Date.now()
    setToasts((toasts) => released(toasts, now - from, now))
  }, [])
  useEffect(() => {
    if (toasts.length === 0) return
    const tick = window.setInterval(() => {
      if (heldAt.current !== undefined) return
      setToasts((toasts) => {
        const left = alive(toasts, Date.now())
        return left.length === toasts.length ? toasts : left
      })
    }, 250)
    return () => clearInterval(tick)
  }, [toasts.length])
  return { toasts, setToasts, hold }
}
