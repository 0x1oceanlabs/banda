/**
 * A new UUIDv7, the kind of ID Banda makes: its time first, so IDs sort
 * by when they were made.
 */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let now = Date.now()
  for (let i = 5; i >= 0; i--) {
    bytes[i] = now % 256
    now = Math.floor(now / 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return textOf(bytes)
}

/**
 * The UUIDv5 of `name` in `namespace`: the same ID each time it is worked
 * out, on any client and in Rust's `uuid::Uuid::new_v5`, so what is
 * derived needs no answer to be known. It names things; it guards
 * nothing, as SHA-1 no longer does.
 */
export function uuidV5(namespace: string, name: string): string {
  const named = new TextEncoder().encode(name)
  const input = new Uint8Array(16 + named.length)
  input.set(bytesOf(namespace))
  input.set(named, 16)
  const id = sha1(input).subarray(0, 16)
  id[6] = (id[6] & 0x0f) | 0x50
  id[8] = (id[8] & 0x3f) | 0x80
  return textOf(id)
}

/**
 * A UUID as Rust prints it, lowercase and with hyphens, from one written
 * with hyphens or without, in either case: the forms a client sends. Any
 * other is refused rather than read as some other ID.
 */
export function canonical(id: string): string {
  return textOf(bytesOf(id))
}

const HYPHENATED =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function bytesOf(id: string): Uint8Array {
  const hex = HYPHENATED.test(id) ? id.replaceAll("-", "") : id
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`"${id}" is no UUID.`)
  return Uint8Array.from({ length: 16 }, (_, i) =>
    parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  )
}

function textOf(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** SHA-1 (RFC 3174), which a UUIDv5 is made with: here, as the browser's
 * own answers only later, and an ID is wanted at once. */
function sha1(bytes: Uint8Array): Uint8Array {
  // The message, a 1 bit, zeros, and its length in bits: whole blocks.
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const message = new DataView(padded.buffer)
  message.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000))
  message.setUint32(padded.length - 4, (bytes.length * 8) >>> 0)
  const h = new Uint32Array([
    0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0,
  ])
  const w = new Uint32Array(80)
  const rotate = (x: number, by: number) => (x << by) | (x >>> (32 - by))
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = message.getUint32(block + i * 4)
    for (let i = 16; i < 80; i++)
      w[i] = rotate(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    let [a, b, c, d, e] = h
    for (let i = 0; i < 80; i++) {
      const f =
        i < 20
          ? ((b & c) | (~b & d)) + 0x5a827999
          : i < 40
            ? (b ^ c ^ d) + 0x6ed9eba1
            : i < 60
              ? ((b & c) | (b & d) | (c & d)) + 0x8f1bbcdc
              : (b ^ c ^ d) + 0xca62c1d6
      const next = (rotate(a, 5) + f + e + w[i]) >>> 0
      e = d
      d = c
      c = rotate(b, 30) >>> 0
      b = a
      a = next
    }
    h[0] += a
    h[1] += b
    h[2] += c
    h[3] += d
    h[4] += e
  }
  const digest = new Uint8Array(20)
  const out = new DataView(digest.buffer)
  h.forEach((word, i) => out.setUint32(i * 4, word))
  return digest
}
