/** Where a popup of `at` stands: past the right of its nearest `edge`, as
 * the sidebar or a menu, else of `at` itself, level with `at`; so it
 * covers none of the rows beside it. Read as the popup is placed. */
export function beside(at: Element, edge: string) {
  return {
    getBoundingClientRect: () => {
      const { top, height } = at.getBoundingClientRect()
      const { right } = (at.closest(edge) ?? at).getBoundingClientRect()
      return DOMRect.fromRect({ x: right, y: top, width: 0, height })
    },
  }
}
