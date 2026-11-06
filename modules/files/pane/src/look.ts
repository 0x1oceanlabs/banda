/**
 * How a file is drawn, from what `files.stat` says it is (ADR 0073,
 * decision 6): its extension first, then its MIME. Pure, so plain tests
 * cover it. Previewers that a module declares come later (step F3).
 */
import type { Stat } from "@banda/contract/files"

/**
 * - `code`: its text, numbered and coloured; one that turns out binary
 *   when read shows its facts.
 * - `markdown`: rendered, with its source a toggle away.
 * - `image`: an `<img>`, an SVG too, never inlined.
 * - `other`: its facts, and that it has no preview yet.
 * - `folder`: its facts; the tree shows a folder (step F1, `files.tree`).
 */
export type Look = "code" | "markdown" | "image" | "other" | "folder"

const MARKDOWN = new Set(["md", "markdown"])

/** What Chromium draws, as the file host serves it. */
const IMAGES = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "svg",
])
const DRAWN = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/svg+xml",
])

/** Text whose MIME says otherwise, as `.ts`, which is MPEG-2 video to the
 * MIME tables. */
const CODE = new Set(
  [
    "ts mts cts tsx js mjs cjs jsx json jsonc json5 jsonl",
    "rs go py rb java kt swift c h cc cpp hpp cs php lua sql zig nix",
    "sh bash zsh fish toml yaml yml ini cfg conf env lock",
    "html htm css scss sass less vue svelte astro xml mdx rst tex",
    "txt log csv tsv diff patch graphql gql proto prisma",
  ]
    .join(" ")
    .split(" ")
)

/** Kinds that are never text: media, documents, archives, programs. */
const NOT_TEXT =
  /^(image|video|audio|font|model)\/|^application\/(pdf|zip|gzip|x-tar|x-7z-compressed|x-rar|x-bzip2|x-xz|zstd|wasm|java-archive|x-executable|x-mach-binary|x-msdownload|x-sharedlib|vnd\.|msword)/

/** A file's extension, lower case; none for a name with none. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1)
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

/** How the file `stat` describes is drawn. */
export function lookOf(stat: Pick<Stat, "path" | "kind" | "mime">): Look {
  if (stat.kind === "folder") return "folder"
  const extension = extensionOf(stat.path)
  const mime = stat.mime ?? ""
  if (MARKDOWN.has(extension) || mime === "text/markdown") return "markdown"
  if (IMAGES.has(extension) || DRAWN.has(mime)) return "image"
  if (CODE.has(extension)) return "code"
  // Anything else is read, and its text decides: a NUL, or bytes that are
  // not UTF-8, make it binary.
  return NOT_TEXT.test(mime) ? "other" : "code"
}

/** What a file is, in a word or two, for its facts. */
export function kindWords(stat: Pick<Stat, "path" | "kind" | "mime">): string {
  if (stat.kind === "folder") return "Folder"
  const [family = ""] = (stat.mime ?? "").split("/")
  const what = ["image", "video", "audio", "font"].includes(family)
    ? family
    : stat.mime === "application/pdf"
      ? "document"
      : "file"
  const extension = extensionOf(stat.path)
  return extension
    ? `${extension.toUpperCase()} ${what}`
    : what[0].toUpperCase() + what.slice(1)
}

/** A size as a Finder writes it: `512 bytes`, `12.3 KB`, `4.1 MB`. */
export function sizeWords(bytes: number): string {
  if (bytes < 1000) return bytes === 1 ? "1 byte" : `${bytes} bytes`
  const units = ["KB", "MB", "GB", "TB"]
  let size = bytes / 1000
  let unit = 0
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000
    unit++
  }
  const shown =
    size < 10 ? size.toFixed(1).replace(/\.0$/, "") : Math.round(size)
  return `${shown} ${units[unit]}`
}
