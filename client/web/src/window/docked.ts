/**
 * The sidebar docked on the left (ADR 0025, decision 10): whether the
 * Person shows it and how wide they dragged it, both kept; and, in a
 * window too narrow for it beside one column, whether it shows over the
 * Strip for now.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from "react"
import { useLookColumns } from "../look"
import { phoneNow } from "../phone"
import {
  keepSidebar,
  keepSidebarWidth,
  loadSidebar,
  loadSidebarWidth,
} from "../tiling/store"
import { useNarrow } from "./narrow"

export function useDocked() {
  const [sidebar, setSidebar] = useState(loadSidebar)
  useEffect(() => keepSidebar(sidebar), [sidebar])
  // How wide the Person dragged it, which the page's every part that
  // starts past it reads.
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth)
  useLayoutEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-width",
      `${sidebarWidth}rem`
    )
  }, [sidebarWidth])
  useEffect(() => keepSidebarWidth(sidebarWidth), [sidebarWidth])
  // Its edge dragged past the narrowest: letting go hides it.
  const [hiding, setHiding] = useState(false)
  // Narrow, the window hides the sidebar and shows it over the Strip when
  // asked; wide, it keeps the Person's choice.
  const columnMin = useLookColumns().min
  const narrow = useNarrow(columnMin, sidebarWidth)
  const [over, setOver] = useState(phoneNow)
  if (over && !narrow) setOver(false)
  const setShown = narrow ? setOver : setSidebar
  const showSidebar = useCallback(() => setShown(true), [setShown])
  const hideSidebar = useCallback(() => setShown(false), [setShown])
  const hideOver = useCallback(() => setOver(false), [])
  return {
    /** The Person's choice, for a window wide enough. */
    sidebar,
    sidebarWidth,
    setSidebarWidth,
    hiding,
    setHiding,
    columnMin,
    narrow,
    /** Shown over the Strip, in a narrow window. */
    over,
    /** Sets whichever of the two the window's width makes the sidebar's. */
    setShown,
    showSidebar,
    hideSidebar,
    hideOver,
  }
}
