import { expect, test } from "vitest"
import { forwardWords, linkForward, linkOf, linkRefused } from "./link"

test("only http(s) makes a Link: file: and app: never reach the device", () => {
  expect(linkOf("https://github.com/a")).toEqual({
    url: "https://github.com/a",
  })
  expect(linkOf("HTTP://localhost:3000/")).toEqual({
    url: "HTTP://localhost:3000/",
  })
  expect(linkOf("file:///etc/passwd")).toBeUndefined()
  expect(linkOf("app://files/secret")).toBeUndefined()
  expect(linkOf("javascript:alert(1)")).toBeUndefined()
  expect(linkOf("not a link")).toBeUndefined()
  // Text a program prints that parses as an address only by accident.
  expect(linkOf("http:8080")).toBeUndefined()
  expect(linkOf("https:443")).toBeUndefined()
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
    "http://[::]:8000/",
    "http://localhost.:3000/",
    "http://[::ffff:127.0.0.1]:3000/",
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
      about: "This device opens no port of another machine.",
      copy: "http://localhost:3000/x",
    },
  })
  expect(linkRefused("https://github.com/a", "arc")).toBeUndefined()
})

test("a machine's own address opens through a forward: its port there, the address read, and localhost here at the port the forward has", () => {
  const forward = linkForward(linkOf("http://localhost:3000/x?y=1#z", "arc")!)!
  expect(forward.of).toBe("arc")
  expect(forward.port).toBe(3000)
  expect(forward.named).toBe("localhost:3000")
  expect(forward.at(3000).href).toBe("http://localhost:3000/x?y=1#z")
  // Taken here, it opens at another port, the rest as it was.
  expect(forward.at(3001).href).toBe("http://localhost:3001/x?y=1#z")
  // The forward listens on loopback, which `localhost` names; a name a
  // page may read stays.
  expect(
    linkForward(linkOf("http://0.0.0.0:8080/", "arc")!)!.at(8080).href
  ).toBe("http://localhost:8080/")
  expect(linkForward(linkOf("http://[::1]:8080/", "arc")!)!.at(8081).href).toBe(
    "http://localhost:8081/"
  )
  expect(
    linkForward(linkOf("http://app.localhost:5173/", "arc")!)!.at(5173).href
  ).toBe("http://app.localhost:5173/")
  // A scheme's own port, where the address names none.
  expect(linkForward(linkOf("http://localhost/", "arc")!)!.port).toBe(80)
  expect(linkForward(linkOf("https://localhost/", "arc")!)!.port).toBe(443)
  // A public page is no machine's.
  expect(linkForward(linkOf("https://github.com/a", "arc")!)).toBeUndefined()
  expect(linkForward(linkOf("http://localhost:3000/")!)).toBeUndefined()
})

test("the forward's words name the address, the machine and the port taken", () => {
  const words = forwardWords("localhost:3000", "arc")
  expect(words.opens).toBe("localhost:3000 opens from arc")
  expect(words.moved(3000, "localhost:3001", "this Mac")).toBe(
    "3000 is taken on this Mac: opens as localhost:3001"
  )
  expect(words.away).toBe("arc is away: localhost:3000 did not open.")
})
