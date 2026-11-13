/**
 * This device's key (ADR 0124, decision 5): what the window proves itself
 * with at an engine's door. An Ed25519 key in a file only its owner reads,
 * in Banda's state, as `engine.json` keeps the owner secret: not the
 * system's keychain yet, which would ask again after every update while
 * the app is signed ad hoc, and needs a secret service on Linux. Main
 * holds it and signs for the page, which never has it.
 *
 * A file that is lost, or cannot be read, is made anew: the window pairs
 * itself with its own machine again (engine.ts), so it is never locked
 * out there.
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
} from "node:crypto"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

/** A device's key: its public half, as an engine pairs it, and what
 * signs with the other. Both as base64url. */
export type DeviceKey = {
  readonly public: string
  readonly sign: (message: string) => string
}

/** The key kept in `file`, made there where none can be read. */
export function deviceKey(file: string): DeviceKey {
  const key = kept(file) ?? made(file)
  // An Ed25519 key's JWK names its public half as the 32 bytes, base64url.
  const { x } = createPublicKey(key).export({ format: "jwk" })
  if (typeof x !== "string") throw new Error(`${file} holds no Ed25519 key.`)
  return {
    public: x,
    sign: (message) =>
      sign(null, Buffer.from(message, "utf8"), key).toString("base64url"),
  }
}

function kept(file: string): KeyObject | undefined {
  try {
    const key = createPrivateKey(readFileSync(file))
    return key.asymmetricKeyType === "ed25519" ? key : undefined
  } catch {
    return undefined
  }
}

/** A new key, written whole, for its owner alone. */
function made(file: string): KeyObject {
  const { privateKey } = generateKeyPairSync("ed25519")
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(
      `${file}.new`,
      privateKey.export({ format: "pem", type: "pkcs8" }),
      { mode: 0o600 }
    )
    renameSync(`${file}.new`, file)
  } catch (error) {
    // It lasts this run: the next makes another, and pairs again.
    console.error(`banda: this device's key was not kept in ${file}`, error)
  }
  return privateKey
}
