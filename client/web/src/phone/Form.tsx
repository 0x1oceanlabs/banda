import { useEffect } from "react"
import { usePhone } from "./is"

/**
 * Says to the page's styles that the window has the phone's form
 * (`data-phone` on the root, read in Banda UI's styles): no bar, the
 * list the whole screen wide, a header with its own buttons alone.
 */
export function PhoneForm() {
  const phone = usePhone()
  useEffect(() => {
    document.documentElement.toggleAttribute("data-phone", phone)
  }, [phone])
  return null
}
