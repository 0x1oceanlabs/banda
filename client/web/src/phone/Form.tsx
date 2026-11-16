import type { ProjectSummary } from "@banda/contract"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react"
import { useYourTurn } from "../sidebar"
import { usePhone } from "./is"

/** How many call the Person, for a phone's way back to the list. */
const Calls = createContext(0)

/** How many call the Person now, on a phone; none elsewhere, where the
 * Bar's counts say it. */
export const useCalls = (): number => useContext(Calls)

/**
 * Says to the page's styles that the window has the phone's form
 * (`data-phone` on the root, read in Banda UI's styles): no bar, the
 * list the whole screen wide, a header with its own buttons alone. And
 * says to the window it holds how many call the Person, as the list's
 * Your turn counts them: a phone has no Bar to say so over a Thread, so
 * its way back does (`back.tsx`).
 */
export function PhoneForm({
  projects,
  children,
}: {
  projects: readonly ProjectSummary[]
  children: ReactNode
}) {
  const phone = usePhone()
  const [calls, setCalls] = useState(0)
  useEffect(() => {
    document.documentElement.toggleAttribute("data-phone", phone)
  }, [phone])
  return (
    <Calls value={phone ? calls : 0}>
      {/* Counted on a phone alone, beside the window, which stays the
          one it was as the form changes. */}
      {phone && <Counted projects={projects} onCount={setCalls} />}
      {children}
    </Calls>
  )
}

function Counted({
  projects,
  onCount,
}: {
  projects: readonly ProjectSummary[]
  onCount: (calls: number) => void
}) {
  const calls = useYourTurn(projects)
  useEffect(() => onCount(calls), [calls, onCount])
  return null
}
