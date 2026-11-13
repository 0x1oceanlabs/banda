import { createPublicKey, verify } from "node:crypto"
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { deviceKey } from "./key"

const holds = (key: { public: string }, message: string, sig: string) =>
  verify(
    null,
    Buffer.from(message, "utf8"),
    createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: key.public },
      format: "jwk",
    }),
    Buffer.from(sig, "base64url")
  )

test("a device's key is made once, in a file only its owner reads, and signs as Ed25519 does", () => {
  const file = join(
    mkdtempSync(join(tmpdir(), "banda-key-")),
    "state/device.key"
  )
  const key = deviceKey(file)
  expect(Buffer.from(key.public, "base64url")).toHaveLength(32)
  expect(key.public).not.toMatch(/[+/=]/)
  if (process.platform !== "win32")
    expect(statSync(file).mode & 0o777).toBe(0o600)
  const sig = key.sign("banda-door/hello/1\nn\nh\napp://banda\nm")
  expect(Buffer.from(sig, "base64url")).toHaveLength(64)
  expect(holds(key, "banda-door/hello/1\nn\nh\napp://banda\nm", sig)).toBe(true)
  expect(holds(key, "another", sig)).toBe(false)
  // The next start reads the same key.
  expect(deviceKey(file).public).toBe(key.public)
})

test("a key file that cannot be read is made anew, so the window pairs again", () => {
  const file = join(mkdtempSync(join(tmpdir(), "banda-key-")), "device.key")
  writeFileSync(file, "not a key")
  const key = deviceKey(file)
  expect(readFileSync(file, "utf8")).toContain("PRIVATE KEY")
  expect(deviceKey(file).public).toBe(key.public)
})
