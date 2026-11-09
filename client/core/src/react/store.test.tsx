import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { Store } from "../store"
import { useStore } from "./store"

test("a reader drawn to text reads what the store holds now", () => {
  const store = new Store({ count: 3, other: "x" })
  function Count() {
    return <>{useStore(store, (value) => value.count)}</>
  }
  expect(renderToStaticMarkup(<Count />)).toBe("3")
})
