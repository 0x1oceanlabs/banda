import { expect, test } from "vitest"
import { linkOf, linkRefused } from "./link"

test("only http(s) makes a Link: file: and app: never reach the device", () => {
  expect(linkOf("https://github.com/a")).toEqual({ url: "https://github.com/a" })
  expect(linkOf("HTTP://localhost:3000/")).toEqual({
    url: "HTTP://localhost:3000/",
  })
  expect(linkOf("file:///etc/passwd")).toBeUndefined()
  expect(linkOf("app://files/secret")).toBeUndefined()
  expect(linkOf("javascript:alert(1)")).toBeUndefined()
  expect(linkOf("not a link")).toBeUndefined()
})

test("an address of the machine's own is named as that machine's; a public page is no machine's", () => {
  expect(linkOf("http://localhost:3000/", "arc")).toEqual({
    url: "http://localhost:3000/",
    of: "arc",
  })
  for (const own of [
    "http://127.0.0.1:8080/",
    "http://[::1]:5173/",
    "http://0.0.0.0:3000/",
    "http://app.localhost/",
  ])
    expect(linkOf(own, "arc")?.of, own).toBe("arc")
  expect(linkOf("https://github.com/a", "arc")).toEqual({
    url: "https://github.com/a",
  })
  // What is shown is the address as the Person reads it, not localhost's.
  expect(linkOf("http://127.0.0.1.evil.example/", "arc")?.of).toBeUndefined()
})

test("another machine's localhost does not open here, says whose it is, and offers its address to copy", () => {
  expect(linkRefused("http://localhost:3000/x", "arc")).toEqual({
    why: "localhost:3000 is arc's",
    offer: {
      about: "It opens here once port forwarding comes.",
      copy: "http://localhost:3000/x",
    },
  })
  expect(linkRefused("https://github.com/a", "arc")).toBeUndefined()
})
