import { expect, test } from "vitest"
import { canonical, uuidV5 } from "../src/ids"

const MADE = "63bdd961-aad0-4575-bfc1-5f1d352969ad"

test("a UUIDv5 is the one every other maker gives", () => {
  // RFC 9562's example of a name in the DNS namespace.
  expect(
    uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "www.example.com")
  ).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2")
  // The kernel's own command ID, `CommandId::derive("a", "b")`.
  expect(uuidV5(uuidV5("1381b1cc-08e3-41ff-b9bd-24b406cbf01c", "a"), "b")).toBe(
    "a6a85341-5cd4-5383-a684-ad949636c543"
  )
})

test("a name of any length is hashed whole, across SHA-1's blocks", () => {
  // Around the lengths where the padding takes another block.
  const ids = Object.fromEntries(
    [39, 40, 55, 56, 64, 120].map((n) => [n, uuidV5(MADE, "x".repeat(n))])
  )
  expect(ids).toEqual({
    39: "069d850e-3736-59b3-b7fa-975ac9f8c9f0",
    40: "eb999459-9e5f-5836-9b16-bea0b36e72a7",
    55: "6caaaf80-3040-5829-b700-6810f72f8a61",
    56: "febb124d-bf17-5d66-8bab-3b59ee74bac3",
    64: "5864ce86-f992-570f-bdb5-19b4c6afb1fb",
    120: "ed0fb02c-07ae-5c36-98b1-7b99501d61a6",
  })
})

test("a UUID reads as Rust prints it, as a client writes it", () => {
  const id = "019a5b2e-3c4d-7e8f-9a0b-1c2d3e4f5a6b"
  for (const written of [id, id.toUpperCase(), id.replaceAll("-", "")])
    expect(canonical(written)).toBe(id)
  for (const written of [
    "not an id",
    `{${id}}`,
    `urn:uuid:${id}`,
    `${id.replaceAll("-", "").slice(0, 30)}-ab-`,
  ])
    expect(() => canonical(written)).toThrow()
})
