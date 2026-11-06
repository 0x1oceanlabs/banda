/**
 * The kinds of file Files draws (ADR 0073, decision 6), each a previewer
 * whose view is loaded only once a file of its kind is shown: code and
 * text, markdown, pictures, PDFs, video, sound, and pages that run their
 * own scripts in the sandbox host. A previewer of another module's may
 * draw a kind better, by its priority, and the Person picks one for an
 * extension with "Open with…".
 */
import { definePreviewer } from "@banda/ui/module"

/** Text whose MIME says otherwise, as `.ts`, which is MPEG-2 video to the
 * MIME tables. */
const CODE = [
  "ts mts cts tsx js mjs cjs jsx json jsonc json5 jsonl",
  "rs go py rb java kt swift c h cc cpp hpp cs php lua sql zig nix",
  "sh bash zsh fish toml yaml yml ini cfg conf env lock",
  "html htm css scss sass less vue svelte astro xml mdx rst tex",
  "txt log csv tsv diff patch graphql gql proto prisma svg",
]
  .join(" ")
  .split(" ")

/** Code and text: any text, read and drawn numbered and coloured. A file
 * that turns out binary shows its facts. */
export const code = definePreviewer({
  id: "files.code",
  title: "Code",
  match: {
    extensions: CODE,
    mimes: [
      "text/*",
      "application/json",
      "application/xml",
      "application/javascript",
      "application/toml",
      "application/yaml",
      "application/x-yaml",
      "application/x-sh",
      "application/sql",
    ],
  },
  priority: 0,
  can: { quick: true, edit: false, find: false },
  load: () => import("./views/code"),
})

/** Markdown, rendered, its source a toggle away. */
export const markdown = definePreviewer({
  id: "files.markdown",
  title: "Markdown",
  match: { extensions: ["md", "markdown"], mimes: ["text/markdown"] },
  priority: 10,
  can: { quick: true, edit: false, find: false },
  load: () => import("./views/markdown"),
})

/** What Chromium draws as a picture, as the file host serves it: an SVG
 * too, never inlined. */
export const image = definePreviewer({
  id: "files.image",
  title: "Image",
  match: {
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"],
    mimes: [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/avif",
      "image/bmp",
      "image/svg+xml",
    ],
    magic: [{ bytes: "\x89PNG" }, { bytes: "\xff\xd8\xff" }, { bytes: "GIF8" }],
  },
  priority: 20,
  can: { quick: true, edit: false, find: false },
  load: () => import("./views/image"),
})

/** A PDF, on PDF.js: its pages, their text to pick and find. */
export const pdf = definePreviewer({
  id: "files.pdf",
  title: "PDF",
  match: {
    extensions: ["pdf"],
    mimes: ["application/pdf"],
    magic: [{ bytes: "%PDF-" }],
  },
  priority: 20,
  can: { quick: true, edit: false, find: true },
  load: () => import("./views/pdf"),
})

/** Video, as Chromium plays it. */
export const video = definePreviewer({
  id: "files.video",
  title: "Video",
  match: {
    extensions: ["mp4", "m4v", "webm", "mov", "ogv", "mkv"],
    mimes: ["video/*"],
    magic: [{ at: 4, bytes: "ftyp" }, { bytes: "\x1a\x45\xdf\xa3" }],
  },
  priority: 20,
  can: { quick: true, edit: false, find: false },
  load: () => import("./views/media").then(({ Video }) => ({ default: Video })),
})

/** Sound, as Chromium plays it. */
export const audio = definePreviewer({
  id: "files.audio",
  title: "Audio",
  match: {
    extensions: ["mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac"],
    mimes: ["audio/*"],
    magic: [{ bytes: "ID3" }, { bytes: "fLaC" }],
  },
  priority: 20,
  can: { quick: true, edit: false, find: false },
  load: () => import("./views/media").then(({ Audio }) => ({ default: Audio })),
})

/** A page, an HTML file or an SVG document, drawn in a frame of the
 * sandbox host, where its scripts run on no origin; its source a toggle
 * away. An SVG is a picture first. */
export const page = definePreviewer({
  id: "files.page",
  title: "Page",
  match: {
    extensions: ["html", "htm", "xhtml", "svg"],
    mimes: ["text/html", "application/xhtml+xml"],
  },
  priority: 10,
  can: { quick: true, edit: false, find: false },
  load: () => import("./views/page"),
})

export const PREVIEWERS = [code, markdown, image, pdf, video, audio, page]
