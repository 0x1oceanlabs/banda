//! What a token is for, what a file is served as by its extension, and the
//! headers each use goes with: the rules of the byte host and the sandbox
//! host, as the window's main process had them (`FileLinks`' `BYTES_HOST`
//! and `PREVIEW_HOST`, until step 4b relayed both hosts here; ADR 0073,
//! decision 5).

use axum::http::{HeaderMap, HeaderName, header};
use banda_kernel::api::Served;
use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::path::Path;
use ts_rs::TS;

/// What a token is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "bytes/")]
pub enum Use {
    /// The whole file, of any kind, at `/b/`: what a Pane the Person
    /// drives shows.
    File,
    /// A picture, a video or a sound alone, at `/b/`: what a reply's paths
    /// ask for, as an Agent writes them.
    Media,
    /// A page, HTML or an SVG document, at `/p/`: into a frame alone, and
    /// sandboxed.
    Page,
}

/// Text of any kind is served as plain text, so nothing in it runs: an
/// HTML file shows as its source.
const TEXT: &str = "text/plain; charset=utf-8";

/// What a file of a kind the byte host does not know is served as.
const BYTES: &str = "application/octet-stream";

/// What a page may do: its own scripts and styles, inline; pictures inline
/// or from the byte host; nothing else, and always sandboxed, with no
/// origin of its own (no `allow-same-origin`).
pub const PAGE_CSP: &str = "default-src 'none'; img-src app://files data:; \
     style-src 'unsafe-inline'; script-src 'unsafe-inline'; sandbox allow-scripts";

/// What a file is served as at `/b/`, by its extension in lower case.
fn served_as(extension: &str) -> &'static str {
    match extension {
        // The images, video and sound a reply shows (ADR 0037, decision 8).
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "ogv" => "video/ogg",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "pdf" => "application/pdf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "txt" | "md" | "markdown" | "mdx" | "rst" | "log" | "csv" | "tsv" => TEXT,
        "json" | "jsonc" | "json5" | "jsonl" | "yaml" | "yml" | "toml" | "ini" | "cfg" | "conf"
        | "env" | "xml" => TEXT,
        "html" | "htm" | "xhtml" | "css" | "scss" | "sass" | "less" => TEXT,
        "js" | "mjs" | "cjs" | "jsx" | "ts" | "mts" | "cts" | "tsx" | "vue" | "svelte" => TEXT,
        "py" | "rb" | "rs" | "go" | "java" | "kt" | "swift" | "c" | "h" | "cc" | "cpp" | "hpp"
        | "cs" | "php" | "lua" | "sql" => TEXT,
        "sh" | "bash" | "zsh" | "fish" | "diff" | "patch" | "lock" => TEXT,
        _ => BYTES,
    }
}

/// What a page is served as at `/p/`, by its extension in lower case; none
/// for a file that is no page.
fn page_as(extension: &str) -> Option<&'static str> {
    match extension {
        "html" | "htm" => Some("text/html; charset=utf-8"),
        "xhtml" => Some("application/xhtml+xml; charset=utf-8"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

/// Whether a file served as `kind` is a picture, a video or a sound.
fn is_media(kind: &str) -> bool {
    ["image/", "video/", "audio/"]
        .iter()
        .any(|media| kind.starts_with(media))
}

impl Use {
    /// What the file at `path` is served as for this use, by its
    /// extension; none for one it does not serve.
    pub fn kind_of(self, path: &Path) -> Option<&'static str> {
        let extension = path
            .extension()
            .and_then(OsStr::to_str)
            .map(str::to_ascii_lowercase)
            .unwrap_or_default();
        match self {
            Use::File => Some(served_as(&extension)),
            Use::Media => Some(served_as(&extension)).filter(|kind| is_media(kind)),
            Use::Page => page_as(&extension),
        }
    }

    /// The route beside the API its token is served by.
    pub fn served(self) -> Served {
        match self {
            Use::File | Use::Media => Served::Bytes,
            Use::Page => Served::Page,
        }
    }

    /// The headers its file goes with, served as `kind`, besides its length
    /// and range.
    pub fn headers(self, kind: &'static str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        let mut set = |name: HeaderName, value: &'static str| {
            headers.insert(name, value.parse().expect("a header's value"));
        };
        set(header::CONTENT_TYPE, kind);
        set(header::X_CONTENT_TYPE_OPTIONS, "nosniff");
        set(header::CACHE_CONTROL, "no-store");
        match self.served() {
            // Any file, to any page that holds its token: a page's scripts
            // never run, and any page may read it, as Banda's page reads a
            // PDF's ranges.
            Served::Bytes => {
                set(
                    header::CONTENT_SECURITY_POLICY,
                    "default-src 'none'; sandbox",
                );
                set(header::ACCEPT_RANGES, "bytes");
                set(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
            }
            Served::Page => {
                set(header::CONTENT_SECURITY_POLICY, PAGE_CSP);
                // Only a frame takes it: no other origin may load it as a
                // part.
                set(
                    HeaderName::from_static("cross-origin-resource-policy"),
                    "same-origin",
                );
                set(header::REFERRER_POLICY, "no-referrer");
            }
        }
        headers
    }
}

/// Whether a request asks for a frame's own page: a navigation into a
/// frame, never a page's fetch, a picture, or a window's page where
/// Chromium says which. Where it says nothing of it, as Electron's handler
/// hears no `Sec-Fetch-*`, a navigation is what asks to be upgraded and
/// names no origin, which a page's fetch cannot ask without a preflight
/// these routes refuse.
pub fn into_frame(headers: &HeaderMap) -> bool {
    let said = |name: &str| headers.get(name).and_then(|value| value.to_str().ok());
    match said("sec-fetch-dest") {
        Some(dest) => dest == "iframe" || dest == "frame",
        None => said("upgrade-insecure-requests") == Some("1") && !headers.contains_key("origin"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn any_file_is_typed_by_its_extension_text_as_plain_text_and_the_rest_as_bytes() {
        let kinds = [
            ("notes.txt", "text/plain; charset=utf-8"),
            ("main.rs", "text/plain; charset=utf-8"),
            ("page.html", "text/plain; charset=utf-8"),
            ("Read Me.MD", "text/plain; charset=utf-8"),
            ("paper.pdf", "application/pdf"),
            ("face.woff2", "font/woff2"),
            ("shot.PNG", "image/png"),
            ("data.bin", "application/octet-stream"),
            ("Makefile", "application/octet-stream"),
            (".bashrc", "application/octet-stream"),
        ];
        for (name, kind) in kinds {
            assert_eq!(Use::File.kind_of(Path::new(name)), Some(kind), "{name}");
        }
    }

    #[test]
    fn media_alone_is_a_picture_a_video_or_a_sound() {
        for name in ["a.png", "a.SVG", "a clip.mp4", "a.m4a"] {
            assert!(Use::Media.kind_of(Path::new(name)).is_some(), "{name}");
        }
        for name in ["secret.txt", "paper.pdf", "face.woff2", "Makefile"] {
            assert_eq!(Use::Media.kind_of(Path::new(name)), None, "{name}");
        }
    }

    #[test]
    fn a_page_is_html_or_an_svg_document_and_nothing_else() {
        let page = |name: &str| Use::Page.kind_of(Path::new(name));
        assert_eq!(page("index.HTML"), Some("text/html; charset=utf-8"));
        assert_eq!(page("a.htm"), Some("text/html; charset=utf-8"));
        assert_eq!(
            page("a.xhtml"),
            Some("application/xhtml+xml; charset=utf-8")
        );
        assert_eq!(page("logo.svg"), Some("image/svg+xml"));
        for name in ["notes.txt", "a.png", "a.js", "html"] {
            assert_eq!(page(name), None, "{name}");
        }
    }

    #[test]
    fn a_page_alone_goes_to_a_frame_and_the_rest_to_bytes() {
        assert_eq!(Use::File.served(), Served::Bytes);
        assert_eq!(Use::Media.served(), Served::Bytes);
        assert_eq!(Use::Page.served(), Served::Page);
    }

    /// What a frame's navigation sends to Electron's handler, which hears
    /// no `Sec-Fetch-*`.
    const FRAME: [(&str, &str); 2] = [
        ("accept", "text/html,application/xhtml+xml,*/*;q=0.8"),
        ("upgrade-insecure-requests", "1"),
    ];

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in pairs {
            let name: HeaderName = name.parse().unwrap();
            headers.insert(name, value.parse().unwrap());
        }
        headers
    }

    #[test]
    fn a_frame_alone_asks_for_a_page_never_a_pages_fetch_a_picture_or_a_window() {
        let with = |more: &[(&str, &str)]| {
            let mut pairs = FRAME.to_vec();
            pairs.extend_from_slice(more);
            headers(&pairs)
        };
        let refused = [
            // Banda's page fetching it, or a picture of it.
            headers(&[("accept", "*/*"), ("origin", "app://banda")]),
            with(&[("origin", "app://banda")]),
            headers(&[("accept", "image/*")]),
            // Where Chromium says what for: a page's fetch, a window's page.
            headers(&[("sec-fetch-mode", "cors"), ("sec-fetch-dest", "empty")]),
            with(&[
                ("sec-fetch-mode", "navigate"),
                ("sec-fetch-dest", "document"),
            ]),
            // Who says nothing.
            HeaderMap::new(),
        ];
        for asked in &refused {
            assert!(!into_frame(asked), "{asked:?}");
        }
        assert!(into_frame(&headers(&FRAME)));
        let framed = [("sec-fetch-mode", "navigate"), ("sec-fetch-dest", "iframe")];
        assert!(into_frame(&headers(&framed)));
    }
}
