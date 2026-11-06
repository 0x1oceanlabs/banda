import { expect, test } from "vitest"
import { agentsPartition, opens, PARTITION, whosePartition } from "./desktop"

const project = "0199a3c4-0000-7000-8000-000000000001"

test("a page loads in the Person's profile or in a Project's Agents', and no other", () => {
  expect(whosePartition(PARTITION)).toBeNull()
  expect(agentsPartition(project)).toBe(`persist:agents-${project}`)
  expect(whosePartition(agentsPartition(project))).toBe(project)
  for (const other of [
    "",
    "persist:other",
    "browser",
    "persist:agents-",
    "persist:agents-work",
    `persist:agents-${project}/x`,
    `persist:agents-${project.toUpperCase()}`,
    `agents-${project}`,
  ])
    expect(whosePartition(other), other).toBeUndefined()
})

test("an Agents' page loads the web alone; the Person's also loads their files", () => {
  for (const agents of [null, project]) {
    expect(opens("https://a.test/", agents)).toBe(true)
    expect(opens("http://127.0.0.1:8080/", agents)).toBe(true)
    expect(opens("about:blank", agents)).toBe(true)
  }
  expect(opens("file:///etc/hostname", null)).toBe(true)
  for (const url of [
    "file:///etc/hostname",
    "about:config",
    "chrome://settings",
    "javascript:alert(1)",
    "data:text/html,hi",
  ])
    expect(opens(url, project), url).toBe(false)
  expect(opens("chrome://settings", null)).toBe(false)
})
