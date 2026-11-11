import type { ProjectId } from "@banda/contract"
import type { Runs } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { linksOf } from "./links"

const R1 = "r1" as ProjectId

/** A Thread's links, its acts answered as the router would. */
function links(answers: Record<string, Runs>) {
  const ran: [string, unknown][] = []
  return {
    ran,
    links: linksOf(
      {
        run: (action, args) => ran.push([action, args]),
        runs: (what) =>
          typeof what === "string" && answers[what]
            ? answers[what]!
            : { runs: true },
      },
      R1
    ),
  }
}

const NOT_ON_ARC: Runs = { runs: false, why: "Not on arc yet" }

test("on this machine a link opens in Banda's browser, and with Ctrl in this device's", () => {
  const { links: on, ran } = links({})
  on.open("https://a.test/", false)
  on.open("https://a.test/", true)
  expect(ran).toEqual([
    ["browser.open", { address: "https://a.test/", project: R1 }],
    ["link.open", { url: "https://a.test/" }],
  ])
  expect(on.inBanda("https://a.test/")).toBe(true)
  expect(on.title("https://a.test/")).toMatch(/Click to open in Banda/)
})

test("on another machine a public link goes to this device's browser through the router, and says so", () => {
  const { links: on, ran } = links({ "browser.open": NOT_ON_ARC })
  on.open("https://a.test/", false)
  expect(ran).toEqual([["link.open", { url: "https://a.test/" }]])
  expect(on.inBanda("https://a.test/")).toBe(false)
  expect(on.opensHere("https://a.test/")).toBe(true)
  expect(on.title("https://a.test/")).toMatch(/^https:\/\/a\.test\/\nOpens in /)
})

test("an address of that machine's own says whose it is", () => {
  const { links: on } = links({
    "browser.open": NOT_ON_ARC,
    "link.open": { runs: false, why: "localhost:3000 is arc's" },
  })
  expect(on.opensHere("http://localhost:3000/")).toBe(false)
  expect(on.title("http://localhost:3000/")).toBe("localhost:3000 is arc's")
})

test("where no window runs actions, nothing opens in Banda", () => {
  const on = linksOf({}, R1)
  expect(on.inBanda("https://a.test/")).toBe(false)
  on.open("https://a.test/", false)
})
