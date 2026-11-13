//! The window's page, as the engine serves it at its door (ADR 0124; SE5):
//! the same page Banda's app shows, for a browser that reaches this
//! machine by any pipe to the door. The page alone is nobody: it is a
//! program anyone at the door may read, as they may read this machine's
//! name. What it does, it does as a device this machine paired, by that
//! device's key, on the door's WebSocket.
//!
//! The files are the page's build: `web/dist/` beside the engine's
//! program, where a packed app has it for its own window, or
//! `client/web/dist` in a checkout.
//! `BANDA_PAGE_FILES` names another folder. An engine with no page
//! answers `GET /` with its one line, as before.
//!
//! Each answer says what the page may load: itself, and nothing from
//! elsewhere. A file is read from the folder only, by a path of plain
//! names. `index.html` is asked for again each time; what the build names
//! by its content is kept by the browser for good.

use axum::Router;
use axum::body::Body;
use axum::http::header::{self, HeaderName, HeaderValue};
use axum::http::{HeaderMap, Request, Response, StatusCode};
use axum::response::IntoResponse;
use std::path::{Component, Path, PathBuf};

/// The variable that names the page's folder, over where Banda finds it.
const FILES_VARIABLE: &str = "BANDA_PAGE_FILES";

/// The folder beside the engine's program, as a packed app lays it out.
const FOLDER: &str = "web/dist";

/// The page's first file.
const INDEX: &str = "index.html";

/// What the page may load and reach (the Content Security Policy): its
/// own files, its own door, and WebAssembly shipped with it, which
/// Ghostty draws terminals with. Styles may be inline, as the page's
/// components set lengths; scripts may not. A file's bytes and a page of
/// a Pane come from this door too. Nothing frames it.
const POLICY: &str = "default-src 'self'; \
    script-src 'self' 'wasm-unsafe-eval'; \
    style-src 'self' 'unsafe-inline'; \
    img-src 'self' data:; \
    media-src 'self'; \
    font-src 'self' data:; \
    connect-src 'self'; \
    worker-src 'self'; \
    manifest-src 'self'; \
    object-src 'none'; \
    base-uri 'none'; \
    form-action 'none'; \
    frame-ancestors 'none'";

/// The page's files on this machine.
#[derive(Clone)]
pub struct Page {
    root: PathBuf,
}

impl Page {
    /// The page this engine carries, `program` being its own, built from
    /// a `checkout` or not; none where no folder with an `index.html` is
    /// found.
    pub fn find(program: &Path, checkout: bool) -> Option<Page> {
        let named = std::env::var_os(FILES_VARIABLE)
            .filter(|named| !named.is_empty())
            .map(PathBuf::from);
        // Where it is, through any link it was started by.
        let program = dunce::canonicalize(program).unwrap_or_else(|_| program.to_owned());
        Self::find_in(named, &program, checkout.then(in_checkout))
    }

    fn find_in(named: Option<PathBuf>, program: &Path, checkout: Option<PathBuf>) -> Option<Page> {
        let beside = program.parent().map(|folder| folder.join(FOLDER));
        let root = match named {
            Some(named) => Some(named),
            None => [beside, checkout]
                .into_iter()
                .flatten()
                .find(|folder| folder.join(INDEX).is_file()),
        }?;
        // Whole, so a file is known to be under it.
        let root = dunce::canonicalize(&root).ok()?;
        root.join(INDEX).is_file().then_some(Page { root })
    }

    /// Where the files are.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The door's answers for the page: `GET /` gives the page to who asks
    /// for one, and `line` to who asks for anything else, as `curl` does;
    /// every other path is a file of the page, or nothing.
    pub fn router<L, F>(self, line: L) -> Router
    where
        L: Fn() -> F + Clone + Send + Sync + 'static,
        F: Future<Output = String> + Send,
    {
        let index = self.clone();
        Router::new()
            .route(
                "/",
                axum::routing::get(move |headers: HeaderMap| {
                    let (index, line) = (index.clone(), line.clone());
                    async move {
                        let mut answer = match wants_a_page(&headers) {
                            true => index.file(INDEX).await,
                            false => line().await.into_response(),
                        };
                        // One address, two answers: a cache keeps them
                        // apart by what was asked for.
                        answer
                            .headers_mut()
                            .insert(header::VARY, HeaderValue::from_static("accept"));
                        answer
                    }
                }),
            )
            .fallback(axum::routing::get(move |request: Request<Body>| {
                let page = self.clone();
                async move { page.file(request.uri().path()).await }
            }))
    }

    /// The file at `path` of the page, with what a browser is to know of
    /// it; 404 for none, and for a path that is not plain names.
    async fn file(&self, path: &str) -> Response<Body> {
        let Some(file) = self.at(path) else {
            return StatusCode::NOT_FOUND.into_response();
        };
        let Ok(bytes) = tokio::fs::read(&file).await else {
            return StatusCode::NOT_FOUND.into_response();
        };
        let kind = mime_guess::from_path(&file).first_or_octet_stream();
        let mut response = bytes.into_response();
        let headers = response.headers_mut();
        let mut set = |name: HeaderName, value: &str| {
            if let Ok(value) = HeaderValue::from_str(value) {
                headers.insert(name, value);
            }
        };
        set(header::CONTENT_TYPE, kind.as_ref());
        set(header::CONTENT_SECURITY_POLICY, POLICY);
        set(header::X_CONTENT_TYPE_OPTIONS, "nosniff");
        set(header::REFERRER_POLICY, "no-referrer");
        set(
            HeaderName::from_static("cross-origin-opener-policy"),
            "same-origin",
        );
        set(header::CACHE_CONTROL, kept(path));
        response
    }

    /// The file under the page's folder that `path` names, by plain names
    /// alone: no `..`, no root, nothing that leaves the folder.
    fn at(&self, path: &str) -> Option<PathBuf> {
        let asked = Path::new(path.trim_start_matches('/'));
        let plain = asked
            .components()
            .all(|part| matches!(part, Component::Normal(_)));
        if !plain || asked.as_os_str().is_empty() {
            return None;
        }
        let file = dunce::canonicalize(self.root.join(asked)).ok()?;
        (file.starts_with(&self.root) && file.is_file()).then_some(file)
    }
}

/// How long a browser keeps the file at `path`: what the build names by
/// its content, under `assets/`, for good; the rest it asks for again, so
/// an updated engine's page is the one that opens.
fn kept(path: &str) -> &'static str {
    match path.trim_start_matches('/').starts_with("assets/") {
        true => "public, max-age=31536000, immutable",
        false => "no-cache",
    }
}

/// Whether who asks takes a page, as a browser says it does.
fn wants_a_page(headers: &HeaderMap) -> bool {
    headers
        .get(header::ACCEPT)
        .and_then(|accept| accept.to_str().ok())
        .is_some_and(|accept| accept.contains("text/html"))
}

/// What the page's package builds, in the checkout this crate was built
/// in.
fn in_checkout() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../client/web/dist")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// An answer's headers, by their lower-case names.
    type Said = HashMap<String, String>;

    /// A page's build in a new folder: its index, a script under
    /// `assets/`, and a secret beside the folder.
    fn built() -> (tempfile::TempDir, Page) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("web/dist");
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::write(root.join(INDEX), "<!doctype html><title>Banda</title>").unwrap();
        std::fs::write(root.join("assets/index-abc123.js"), "export {}").unwrap();
        std::fs::write(dir.path().join("secret"), "s3cr3t").unwrap();
        let page = Page::find_in(Some(root), Path::new("/nowhere/banda"), None).unwrap();
        (dir, page)
    }

    /// What the door answers `GET path`, asked over a connection of its
    /// own as a browser or `curl` asks, with `accept` where it says what
    /// it takes: the status, the headers by their lower-case names, and
    /// the body.
    async fn get(page: &Page, path: &str, accept: Option<&str>) -> (StatusCode, Said, String) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let line = || std::future::ready("Banda on arc · HOSTKEY\n".to_owned());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let at = listener.local_addr().unwrap();
        let router = page.clone().router(line);
        let serving = tokio::spawn(async move { axum::serve(listener, router).await });
        let mut stream = tokio::net::TcpStream::connect(at).await.unwrap();
        let accept = accept.map_or(String::new(), |accept| format!("Accept: {accept}\r\n"));
        let asked =
            format!("GET {path} HTTP/1.1\r\nHost: door\r\n{accept}Connection: close\r\n\r\n");
        stream.write_all(asked.as_bytes()).await.unwrap();
        let mut answered = Vec::new();
        stream.read_to_end(&mut answered).await.unwrap();
        serving.abort();
        let answered = String::from_utf8_lossy(&answered).into_owned();
        let (head, body) = answered.split_once("\r\n\r\n").unwrap();
        let mut lines = head.lines();
        let status = lines.next().unwrap().split(' ').nth(1).unwrap();
        let said = lines
            .filter_map(|line| line.split_once(": "))
            .map(|(name, value)| (name.to_ascii_lowercase(), value.to_owned()))
            .collect();
        (
            StatusCode::from_bytes(status.as_bytes()).unwrap(),
            said,
            body.to_owned(),
        )
    }

    #[tokio::test]
    async fn a_browser_gets_the_page_and_curl_the_machine_s_line() {
        let (_dir, page) = built();
        let (status, headers, body) = get(&page, "/", Some("text/html,*/*;q=0.8")).await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains("<title>Banda</title>"));
        assert_eq!(headers["content-type"], "text/html");
        assert_eq!(headers["cache-control"], "no-cache");
        // What it may load: itself alone, and no script written into it.
        let policy = &headers["content-security-policy"];
        assert!(policy.contains("default-src 'self'"));
        assert!(policy.contains("script-src 'self' 'wasm-unsafe-eval';"));
        assert!(policy.contains("frame-ancestors 'none'"));
        assert_eq!(headers["x-content-type-options"], "nosniff");
        assert_eq!(headers["vary"], "accept");

        let (status, _, body) = get(&page, "/", Some("*/*")).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "Banda on arc · HOSTKEY\n");
        let (_, _, body) = get(&page, "/", None).await;
        assert_eq!(body, "Banda on arc · HOSTKEY\n");
    }

    #[tokio::test]
    async fn a_file_of_the_build_is_kept_for_good_and_nothing_outside_the_folder_is_read() {
        let (_dir, page) = built();
        let (status, headers, body) = get(&page, "/assets/index-abc123.js", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "export {}");
        assert!(headers["content-type"].contains("javascript"));
        assert!(headers["cache-control"].contains("immutable"));
        for outside in [
            "/../secret",
            "/assets/../../secret",
            "/%2e%2e/secret",
            "//etc/passwd",
            "/assets",
            "/none.js",
        ] {
            let (status, _, body) = get(&page, outside, None).await;
            assert_eq!(status, StatusCode::NOT_FOUND, "{outside}");
            assert!(!body.contains("s3cr3t"), "{outside}");
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_link_in_the_folder_that_leads_out_of_it_is_no_file_of_the_page() {
        let (dir, page) = built();
        let leak = page.root().join("assets/leak");
        std::os::unix::fs::symlink(dir.path().join("secret"), &leak).unwrap();
        let (status, _, body) = get(&page, "/assets/leak", None).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert!(!body.contains("s3cr3t"));
        // One that stays inside is a file like any other.
        let inside = page.root().join("assets/again.js");
        std::os::unix::fs::symlink(page.root().join("assets/index-abc123.js"), &inside).unwrap();
        let (status, _, body) = get(&page, "/assets/again.js", None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, "export {}");
    }

    #[test]
    fn a_page_is_found_beside_the_program_then_in_the_checkout_and_none_without_its_index() {
        let dir = tempfile::tempdir().unwrap();
        let program = dir.path().join("copy/banda");
        let beside = dir.path().join("copy/web/dist");
        let checkout = dir.path().join("checkout/client/web/dist");
        assert!(Page::find_in(None, &program, Some(checkout.clone())).is_none());
        std::fs::create_dir_all(&checkout).unwrap();
        // A folder with no index is no page.
        assert!(Page::find_in(None, &program, Some(checkout.clone())).is_none());
        std::fs::write(checkout.join(INDEX), "").unwrap();
        let found = Page::find_in(None, &program, Some(checkout.clone())).unwrap();
        assert!(found.root().ends_with("checkout/client/web/dist"));
        std::fs::create_dir_all(&beside).unwrap();
        std::fs::write(beside.join(INDEX), "").unwrap();
        let found = Page::find_in(None, &program, Some(checkout.clone())).unwrap();
        assert!(found.root().ends_with("copy/web/dist"));
        // Named, only that folder, with its index or none.
        let named = dir.path().join("named");
        assert!(Page::find_in(Some(named.clone()), &program, Some(checkout)).is_none());
        std::fs::create_dir_all(&named).unwrap();
        std::fs::write(named.join(INDEX), "").unwrap();
        assert!(Page::find_in(Some(named), &program, None).is_some());
    }
}
