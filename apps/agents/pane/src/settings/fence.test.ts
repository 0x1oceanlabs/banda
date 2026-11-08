import type { Fence } from "@banda/contract"
import { expect, test } from "vitest"
import {
  fullAccessAbout,
  noticeOf,
  reasonOf,
  shortReasonOf,
  warns,
} from "./fence"

const whole: Fence = { fence: "holds", layers: ["namespaces", "landlock"] }
const docker: Fence = { ...whole, docker_group: true }
const partly: Fence = { fence: "holds", layers: ["namespaces"] }
const both: Fence = { ...partly, docker_group: true }
const off: Fence = { fence: "missing", why: "off", words: "BANDA_FENCE=off" }

test("where the fence holds whole, Full access is the Agent's own rights, and nothing needs saying", () => {
  expect(fullAccessAbout(whole)).toBe(
    "Never asks, and works with your rights, not Banda's."
  )
  expect(reasonOf(whole)).toBeUndefined()
  expect(shortReasonOf(whole)).toBeUndefined()
})

test("anywhere else, Full access is the Person, in Banda too, and the menu says why", () => {
  for (const fence of [docker, partly, both, off, undefined])
    expect(fullAccessAbout(fence)).toBe(
      "Never asks. This Agent is you, in Banda too."
    )
  expect(reasonOf(off)).toBe(
    "No fence: turned off for testing (BANDA_FENCE=off)."
  )
  expect(reasonOf(docker)).toMatch(
    /^You're in the docker group: through Docker/
  )
  expect(shortReasonOf(docker)).toBe("You're in the docker group.")
  expect(shortReasonOf(partly)).toBe("The fence has gaps.")
  expect(shortReasonOf(off)).toBe(reasonOf(off))
})

test("before the engine said, the menu says no reason", () => {
  expect(reasonOf(undefined)).toBeUndefined()
})

test("only the docker group warns: it is the Person's own setup", () => {
  expect(warns(docker)).toBe(true)
  expect(warns(partly)).toBe(false)
  expect(warns(off)).toBe(false)
})

test("in the docker group on a Linux with gaps, the reason names both: leaving the group alone gives no Full access", () => {
  expect(reasonOf(both)).toMatch(
    /^The fence has gaps, and you're in the docker group/
  )
  expect(shortReasonOf(both)).toBe(
    "The fence has gaps; you're in the docker group."
  )
  expect(warns(both)).toBe(true)
})

test("the notice of Threads from before the fence is told silently, with why, and leads to the Fence row", () => {
  expect(noticeOf(off)).toEqual({
    key: "fence.supervised",
    kind: "done",
    title: "Threads now start Supervised",
    body: "No fence: turned off for testing (BANDA_FENCE=off).",
    buttons: [
      {
        label: "Learn more",
        action: "settings.open",
        args: { link: "general/fence" },
      },
    ],
    silent: true,
  })
})
