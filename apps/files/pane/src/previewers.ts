/**
 * The kinds of file Files draws (ADR 0073, decision 6), each a previewer
 * whose view is loaded only once a file of its kind is shown: code and
 * text, markdown, pictures, PDFs, video, sound, pages that run their own
 * scripts in the sandbox host, tables, JSON, notebooks, fonts, archives,
 * workbooks, and the bytes of any file nothing else draws. A previewer
 * of another module's may draw a kind better, by its priority, and the
 * Person picks one for an extension with "Open with…".
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
  elsewhere: true,
  load: () => import("./views/code"),
})

/** Markdown, rendered, its source a toggle away. */
export const markdown = definePreviewer({
  id: "files.markdown",
  title: "Markdown",
  match: { extensions: ["md", "markdown"], mimes: ["text/markdown"] },
  priority: 10,
  can: { quick: true, edit: false, find: false },
  elsewhere: true,
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
  elsewhere: true,
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
  elsewhere: true,
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
  elsewhere: true,
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
  elsewhere: true,
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
  elsewhere: true,
  load: () => import("./views/page"),
})

/** A CSV or a TSV as a table, its delimiter sniffed. */
export const table = definePreviewer({
  id: "files.table",
  title: "Table",
  match: {
    extensions: ["csv", "tsv"],
    mimes: ["text/csv", "text/tab-separated-values"],
  },
  priority: 10,
  can: { quick: true, edit: false, find: false },
  elsewhere: true,
  load: () => import("./views/table"),
})

/** JSON, JSONC and JSON Lines as a tree that folds. */
export const json = definePreviewer({
  id: "files.json",
  title: "JSON",
  match: {
    extensions: ["json", "jsonc", "jsonl", "ndjson", "geojson"],
    mimes: ["application/json", "application/x-ndjson"],
  },
  priority: 10,
  can: { quick: true, edit: false, find: false },
  elsewhere: true,
  load: () => import("./views/json"),
})

/** A Jupyter notebook as it saved its outputs; nothing in it runs. */
export const notebook = definePreviewer({
  id: "files.notebook",
  title: "Notebook",
  match: { extensions: ["ipynb"], mimes: ["application/x-ipynb+json"] },
  priority: 10,
  can: { quick: true, edit: false, find: false },
  elsewhere: true,
  load: () => import("./views/notebook"),
})

/** A font as a specimen. */
export const font = definePreviewer({
  id: "files.font",
  title: "Font",
  match: {
    extensions: ["ttf", "otf", "woff", "woff2", "ttc"],
    mimes: ["font/*", "application/font-woff", "application/x-font-ttf"],
    magic: [
      { bytes: "\x00\x01\x00\x00" },
      { bytes: "OTTO" },
      { bytes: "wOFF" },
      { bytes: "wOF2" },
      { bytes: "ttcf" },
    ],
  },
  priority: 20,
  can: { quick: true, edit: false, find: false },
  elsewhere: true,
  load: () => import("./views/font"),
})

/** A zip, a tar, a gzipped tar or a 7z as the names it holds. */
export const archive = definePreviewer({
  id: "files.archive",
  title: "Archive",
  match: {
    extensions: ["zip", "jar", "tar", "tgz", "gz", "7z"],
    mimes: [
      "application/zip",
      "application/x-tar",
      "application/gzip",
      "application/x-gzip",
      "application/x-7z-compressed",
    ],
    magic: [
      { bytes: "PK\x03\x04" },
      { bytes: "PK\x05\x06" },
      { bytes: "\x1f\x8b" },
      { bytes: "7z\xbc\xaf\x27\x1c" },
      { at: 257, bytes: "ustar" },
    ],
  },
  priority: 20,
  can: { quick: true, edit: false, find: false },
  elsewhere: true,
  load: () => import("./views/archive"),
})

/** A workbook's sheets as tables. */
export const sheet = definePreviewer({
  id: "files.sheet",
  title: "Sheet",
  match: {
    extensions: ["xlsx", "xlsm", "xlsb", "xls", "ods"],
    mimes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/vnd.oasis.opendocument.spreadsheet",
    ],
  },
  priority: 20,
  can: { quick: true, edit: false, find: false },
  elsewhere: true,
  load: () => import("./views/sheet"),
})

/** Any file's bytes, for one nothing else draws. */
export const hex = definePreviewer({
  id: "files.hex",
  title: "Hex",
  match: { any: true },
  priority: 0,
  can: { quick: true, edit: false, find: false },
  elsewhere: true,
  load: () => import("./views/hex"),
})

export const PREVIEWERS = [
  code,
  markdown,
  image,
  pdf,
  video,
  audio,
  page,
  table,
  json,
  notebook,
  font,
  archive,
  sheet,
  hex,
]
