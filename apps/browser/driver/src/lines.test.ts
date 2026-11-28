import { PassThrough } from "node:stream"
import { setTimeout as sleep } from "node:timers/promises"
import { expect, test } from "vitest"
import type { Calls } from "./browsers"
import { serve } from "./lines"
import { noTab, Refusal } from "./refusal"

/** The driver's lines over `calls`: what is written to it, and each line
 * it answered so far. */
function lines(calls: Partial<Calls>) {
  const input = new PassThrough()
  const output = new PassThrough()
  const answers: unknown[] = []
  const said: string[] = []
  let closed = 0
  output.setEncoding("utf8")
  let rest = ""
  output.on("data", (chunk: string) => {
    const parts = (rest + chunk).split("\n")
    rest = parts.pop()!
    for (const line of parts) answers.push(JSON.parse(line))
  })
  const served = serve(
    input,
    output,
    {
      call: async () => null,
      close: async () => void closed++,
      ...calls,
    },
    (message) => said.push(message)
  )
  return {
    send: (...requests: unknown[]) => {
      for (const request of requests)
        input.write(
          `${typeof request === "string" ? request : JSON.stringify(request)}\n`
        )
    },
    end: () => {
      input.end()
      return served
    },
    answers,
    said,
    closed: () => closed,
  }
}

test("a request is answered by its id: ok with what the call gave, or refused by its code", async () => {
  const driver = lines({
    call: async (method, params) => {
      if (method === "where") return { url: "https://a.test/", ...params }
      if (method === "close") return undefined
      if (method === "snapshot") throw noTab(9)
      if (method === "act") throw new Refusal({ message: "e2 is not there." })
      throw new TypeError("a bug")
    },
  })
  driver.send(
    { id: 1, method: "where", params: { tab: 3 } },
    { id: 2, method: "close", params: { tab: 3 } },
    { id: 3, method: "snapshot", params: { tab: 9 } },
    { id: 4, method: "act", params: {} },
    { id: 5, method: "open" }
  )
  await driver.end()
  expect(driver.answers).toEqual([
    { id: 1, ok: { url: "https://a.test/", tab: 3 } },
    { id: 2, ok: null },
    {
      id: 3,
      refused: {
        code: "not_found",
        message: "There is no tab 9: browser_tabs lists them.",
      },
    },
    // A refusal that names no code is a conflict.
    { id: 4, refused: { code: "conflict", message: "e2 is not there." } },
    // What is no refusal is the driver's own fault.
    { id: 5, refused: { code: "internal", message: "a bug" } },
  ])
})

test("what is no request is skipped and said; one with an id and no method is invalid", async () => {
  const called: string[] = []
  const driver = lines({
    call: async (method) => {
      called.push(method)
      return null
    },
  })
  driver.send(
    "not json",
    "[1, 2]",
    { method: "open", params: {} },
    "",
    { id: 4 },
    { id: 5, method: "open", params: [1] },
    { id: 6, method: "tabs", params: { profile: "/p" } }
  )
  await driver.end()
  expect(driver.said).toHaveLength(3)
  expect(driver.said[0]).toContain("not json")
  expect(called).toEqual(["tabs"])
  expect(driver.answers).toEqual([
    {
      id: 4,
      refused: {
        code: "invalid",
        message: 'A request is {"id", "method", "params"}.',
      },
    },
    {
      id: 5,
      refused: {
        code: "invalid",
        message: 'A request is {"id", "method", "params"}.',
      },
    },
    { id: 6, ok: null },
  ])
})

test("requests run side by side, and each is answered as it is done", async () => {
  const driver = lines({
    call: async (method) => {
      if (method === "wait_for") await sleep(50)
      return method
    },
  })
  driver.send(
    { id: 1, method: "wait_for", params: { tab: 1 } },
    { id: 2, method: "where", params: { tab: 2 } }
  )
  await sleep(10)
  expect(driver.answers).toEqual([{ id: 2, ok: "where" }])
  await sleep(80)
  expect(driver.answers).toHaveLength(2)
  await driver.end()
})

test("the input closing closes every Chromium, and only then is it over", async () => {
  const driver = lines({})
  driver.send({ id: 1, method: "where", params: {} })
  await sleep(10)
  expect(driver.closed()).toBe(0)
  await driver.end()
  expect(driver.closed()).toBe(1)
})
