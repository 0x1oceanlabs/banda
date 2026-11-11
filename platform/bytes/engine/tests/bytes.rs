//! The bytes module through the kernel and the routes beside its API, as
//! a window uses them (ADR 0106, step 4a): `bytes.issue` gives a token as
//! reading the file allows, and `/b/<token>` and `/p/<token>` serve it.
//! These are the tests of the window's byte host and sandbox host
//! (`client/desktop-kit/src/files.test.ts`, `preview.test.ts`), over HTTP.

use banda_bytes::{Bytes, HOUR, Issued, PAGE_CSP};
use banda_kernel::api::{self, OwnerSecret};
use banda_kernel::{AgentId, Caller, Code, CommandId, Kernel, Participant, PersonId, ProjectId};
use reqwest::StatusCode;
use reqwest::header::{self, HeaderMap};
use serde_json::json;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, Ordering};

/// A kernel with the bytes module, a Project in a throwaway folder, and
/// the engine's routes served on a free port of this machine.
struct World {
    kernel: Arc<Kernel>,
    owner: PersonId,
    project: ProjectId,
    folder: PathBuf,
    address: SocketAddr,
    /// The module's clock, when a test sets it; this machine's at 0.
    at: Arc<AtomicI64>,
    http: reqwest::Client,
    root: tempfile::TempDir,
    /// The module itself, as another module holds it.
    bytes: Bytes,
}

impl World {
    async fn new() -> World {
        let root = tempfile::tempdir().unwrap();
        let owner = PersonId::new();
        let at = Arc::new(AtomicI64::new(0));
        let clock = at.clone();
        let bytes = Bytes::on_clock(Arc::new(move || match clock.load(Ordering::SeqCst) {
            0 => banda_kernel::now_ms(),
            at => at,
        }));
        let kernel = Kernel::builder(root.path(), root.path().join(".data"), owner)
            .module(bytes.clone())
            .open()
            .await
            .unwrap();
        let made = (kernel.call(
            Participant::Person(owner),
            "projects.create",
            None,
            Some(CommandId::new()),
            json!({ "name": "Work" }),
        ))
        .await
        .unwrap();
        let project: ProjectId = serde_json::from_value(made["id"].clone()).unwrap();
        let folder = kernel.project(project).await.unwrap().folder();
        let folder = dunce::canonicalize(folder).unwrap();
        // The engine's routes, as `banda serve` serves them.
        let identity = OwnerSecret {
            secret: "secret".to_owned(),
            owner,
        };
        let app = api::router(kernel.clone(), identity, "test").merge(api::bytes(bytes.clone()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let http = reqwest::Client::builder().no_proxy().build().unwrap();
        World {
            kernel,
            owner,
            project,
            folder,
            address,
            at,
            http,
            root,
            bytes,
        }
    }

    fn write(&self, name: &str, text: &str) -> PathBuf {
        let path = self.folder.join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, text).unwrap();
        path
    }

    /// A folder beside the Project's, outside it, with a secret in it.
    fn outside(&self) -> PathBuf {
        let outside = dunce::canonicalize(self.root.path())
            .unwrap()
            .join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.png"), "secret").unwrap();
        outside
    }

    /// `bytes.issue` as the Person, in the Project.
    async fn issue(
        &self,
        path: impl AsRef<Path>,
        used: &str,
    ) -> Result<Issued, banda_kernel::Refusal> {
        let person = Participant::Person(self.owner);
        let params = json!({ "path": path.as_ref(), "use": used });
        let issued = (self.kernel)
            .call(person, "bytes.issue", Some(self.project), None, params)
            .await?;
        Ok(serde_json::from_value(issued).unwrap())
    }

    /// `bytes.issue` as an Agent, whose pass walls it in the Project.
    async fn issue_as_agent(
        &self,
        path: impl AsRef<Path>,
        used: &str,
    ) -> Result<Issued, banda_kernel::Refusal> {
        let agent = Caller::agent(AgentId::new(), self.project);
        let params = json!({ "path": path.as_ref(), "use": used });
        let issued = self
            .kernel
            .call(agent, "bytes.issue", None, None, params)
            .await?;
        Ok(serde_json::from_value(issued).unwrap())
    }

    /// The code a refused `bytes.issue` as the Person says.
    async fn refused(&self, path: impl AsRef<Path>, used: &str) -> Code {
        let path = path.as_ref();
        match self.issue(path, used).await {
            Ok(_) => panic!("{} as {used} was given a token", path.display()),
            Err(refused) => refused.code,
        }
    }

    fn url(&self, route: &str, token: &str) -> String {
        format!("http://{}/{route}/{token}", self.address)
    }

    /// What `GET /<route>/<token>` answers, asked with `headers`.
    async fn get(&self, route: &str, token: &str, headers: &[(&str, &str)]) -> Answer {
        self.asked(reqwest::Method::GET, &self.url(route, token), headers)
            .await
    }

    /// What `/b/<token>` answers.
    async fn bytes(&self, token: &str) -> Answer {
        self.get("b", token, &[]).await
    }

    /// What `/b/<token>` answers, asked for `range`.
    async fn range(&self, token: &str, range: &str) -> Answer {
        self.get("b", token, &[("range", range)]).await
    }

    /// What `/p/<token>` answers, asked as a frame's navigation.
    async fn page(&self, token: &str) -> Answer {
        self.get("p", token, &FRAME).await
    }

    async fn asked(&self, method: reqwest::Method, url: &str, headers: &[(&str, &str)]) -> Answer {
        let mut request = self.http.request(method, url);
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let answer = request.send().await.unwrap();
        Answer {
            status: answer.status(),
            headers: answer.headers().clone(),
            body: answer.text().await.unwrap(),
        }
    }
}

/// An answer of the routes beside the API.
struct Answer {
    status: StatusCode,
    headers: HeaderMap,
    body: String,
}

impl Answer {
    fn header(&self, name: impl header::AsHeaderName) -> Option<&str> {
        self.headers.get(name).map(|value| value.to_str().unwrap())
    }
}

/// What a frame's navigation sends to Electron's handler, which hears no
/// `Sec-Fetch-*`.
const FRAME: [(&str, &str); 2] = [
    ("accept", "text/html,application/xhtml+xml,*/*;q=0.8"),
    ("upgrade-insecure-requests", "1"),
];

#[tokio::test]
async fn media_is_given_a_token_typed_streamed_and_read_in_ranges() {
    let world = World::new().await;
    let path = world.write("a clip.mp4", "0123456789");
    let before = banda_kernel::now_ms();
    let issued = world.issue(&path, "media").await.unwrap();
    let after = banda_kernel::now_ms();
    // 256 bits from the system's randomness, in hex: none is guessed.
    assert_eq!(issued.token.len(), 64);
    assert!(issued.token.bytes().all(|b| b.is_ascii_hexdigit()));
    assert!(
        (before + HOUR..=after + HOUR).contains(&issued.until),
        "an hour"
    );

    let full = world.bytes(&issued.token).await;
    assert_eq!(full.status, StatusCode::OK);
    assert_eq!(full.header(header::CONTENT_TYPE), Some("video/mp4"));
    assert_eq!(full.header(header::X_CONTENT_TYPE_OPTIONS), Some("nosniff"));
    assert_eq!(full.header(header::ACCEPT_RANGES), Some("bytes"));
    assert_eq!(full.header(header::CACHE_CONTROL), Some("no-store"));
    assert_eq!(full.body, "0123456789");

    let partial = world.range(&issued.token, "bytes=3-6").await;
    assert_eq!(partial.status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(partial.header(header::CONTENT_RANGE), Some("bytes 3-6/10"));
    assert_eq!(partial.header(header::CONTENT_LENGTH), Some("4"));
    assert_eq!(partial.body, "3456");

    let url = world.url("b", &issued.token);
    let head = world.asked(reqwest::Method::HEAD, &url, &[]).await;
    assert_eq!(head.status, StatusCode::OK);
    assert_eq!(head.header(header::CONTENT_LENGTH), Some("10"));
    assert_eq!(head.body, "");

    // Two tokens for one file are two.
    let again = world.issue(&path, "media").await.unwrap();
    assert_ne!(again.token, issued.token);
}

#[tokio::test]
async fn any_file_is_served_typed_by_its_extension_and_nothing_in_it_runs() {
    let world = World::new().await;
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
    ];
    for (name, kind) in kinds {
        world.write(name, "<script>alert(1)</script>");
        let issued = world.issue(name, "file").await.unwrap();
        let answer = world.bytes(&issued.token).await;
        assert_eq!(answer.status, StatusCode::OK, "{name}");
        assert_eq!(answer.header(header::CONTENT_TYPE), Some(kind), "{name}");
        assert_eq!(
            answer.header(header::X_CONTENT_TYPE_OPTIONS),
            Some("nosniff")
        );
        let csp = answer.header(header::CONTENT_SECURITY_POLICY);
        assert_eq!(csp, Some("default-src 'none'; sandbox"));
        assert_eq!(
            answer.header(header::ACCESS_CONTROL_ALLOW_ORIGIN),
            Some("*")
        );
        assert_eq!(answer.body, "<script>alert(1)</script>");
    }
}

#[cfg(unix)]
#[tokio::test]
async fn media_alone_is_what_a_replys_paths_get_and_a_link_may_not_turn_into_another_kind() {
    let world = World::new().await;
    world.write("secret.txt", "secret");
    world.write("image.png", "image");
    std::os::unix::fs::symlink(
        world.folder.join("secret.txt"),
        world.folder.join("looks like.png"),
    )
    .unwrap();
    assert_eq!(world.refused("secret.txt", "media").await, Code::Invalid);
    assert_eq!(
        world.refused("looks like.png", "media").await,
        Code::Invalid
    );
    // Nor a picture of a file of another kind of media.
    world.write("a clip.mp4", "clip");
    std::os::unix::fs::symlink(
        world.folder.join("a clip.mp4"),
        world.folder.join("clip.png"),
    )
    .unwrap();
    assert_eq!(world.refused("clip.png", "media").await, Code::Invalid);
    assert!(world.issue("a clip.mp4", "media").await.is_ok());
    assert!(world.issue("image.png", "media").await.is_ok());
    // A Pane the Person drives asks for any file: the link's target is
    // served as what it is.
    let issued = world.issue("looks like.png", "file").await.unwrap();
    let answer = world.bytes(&issued.token).await;
    assert_eq!(
        answer.header(header::CONTENT_TYPE),
        Some("text/plain; charset=utf-8")
    );
    assert_eq!(answer.body, "secret");
}

#[tokio::test]
async fn an_unknown_token_one_past_its_hour_and_one_with_more_get_nothing() {
    let world = World::new().await;
    world.write("image.png", "image");
    let issued = world.issue("image.png", "file").await.unwrap();
    assert_eq!(world.bytes(&issued.token).await.status, StatusCode::OK);
    let other = "0".repeat(64);
    assert_eq!(world.bytes(&other).await.status, StatusCode::NOT_FOUND);
    let longer = format!("{}x", issued.token);
    assert_eq!(world.bytes(&longer).await.status, StatusCode::NOT_FOUND);
    let shorter = &issued.token[1..];
    assert_eq!(world.bytes(shorter).await.status, StatusCode::NOT_FOUND);
    let queried = format!("{}?x=1", issued.token);
    assert_eq!(world.bytes(&queried).await.status, StatusCode::NOT_FOUND);
    let deeper = format!("{}/more", issued.token);
    assert_eq!(world.bytes(&deeper).await.status, StatusCode::NOT_FOUND);
    // Asked to change it, it refuses.
    let url = world.url("b", &issued.token);
    let posted = world.asked(reqwest::Method::POST, &url, &[]).await;
    assert_eq!(posted.status, StatusCode::METHOD_NOT_ALLOWED);
    // An hour on, it serves nothing.
    world.at.store(issued.until - 1, Ordering::SeqCst);
    assert_eq!(world.bytes(&issued.token).await.status, StatusCode::OK);
    world.at.store(issued.until, Ordering::SeqCst);
    assert_eq!(
        world.bytes(&issued.token).await.status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn a_path_starts_at_the_projects_folder_and_one_from_home_the_network_or_a_scheme_gets_none()
{
    let world = World::new().await;
    let path = world.write("notes.md", "# Notes");
    let issued = world.issue("notes.md", "file").await.unwrap();
    assert_eq!(world.bytes(&issued.token).await.body, "# Notes");
    assert!(world.issue(&path, "file").await.is_ok(), "whole");
    assert_eq!(world.refused("notes.md", "media").await, Code::Invalid);
    for asked in [
        String::new(),
        "~/notes.md".to_owned(),
        format!("file://{}", path.display()),
        "//server/notes.md".to_owned(),
        "\\\\server\\notes.md".to_owned(),
    ] {
        assert_eq!(
            world.refused(&asked, "file").await,
            Code::Invalid,
            "{asked:?}"
        );
    }
    assert_eq!(world.refused("a\0.png", "file").await, Code::Invalid);
    assert_eq!(world.refused("absent.png", "file").await, Code::NotFound);
    std::fs::create_dir(world.folder.join("folder.png")).unwrap();
    assert_eq!(world.refused("folder.png", "file").await, Code::Invalid);
    assert_eq!(world.refused(&world.folder, "file").await, Code::Invalid);
    // Nor is one given in a Project this machine does not have.
    let person = Participant::Person(world.owner);
    let params = json!({ "path": path, "use": "file" });
    let unknown = (world.kernel)
        .call(person, "bytes.issue", Some(ProjectId::new()), None, params)
        .await;
    assert_eq!(unknown.unwrap_err().code, Code::NotFound);
}

/// On Windows a file's stream, or a path on a drive but from no folder, is
/// refused before the disk is looked at, as a share is.
#[cfg(windows)]
#[tokio::test]
async fn a_stream_or_a_path_from_no_folder_is_refused_on_windows() {
    let world = World::new().await;
    world.write("notes.md", "# Notes");
    for asked in ["notes.md:hidden", "notes.md::$DATA", "C:notes.md"] {
        assert_eq!(world.refused(asked, "file").await, Code::Invalid, "{asked}");
    }
}

#[tokio::test]
async fn the_person_reaches_a_file_outside_the_project_as_the_window_did() {
    let world = World::new().await;
    let outside = world.outside();
    let issued = world
        .issue(outside.join("secret.png"), "file")
        .await
        .unwrap();
    assert_eq!(world.bytes(&issued.token).await.body, "secret");
    assert!(world.issue("../outside/secret.png", "media").await.is_ok());
}

/// The window's hosts gave a link to the window alone, and `/b/` is
/// served outside the fence, past the wall Files keeps an Agent behind.
#[tokio::test]
async fn an_agent_is_given_no_token_not_even_for_a_file_of_its_project() {
    let world = World::new().await;
    let outside = world.outside();
    let inside = world.write("in.png", "in");
    for asked in [
        PathBuf::from("in.png"),
        inside,
        outside.join("secret.png"),
        PathBuf::from("../outside/secret.png"),
    ] {
        for used in ["file", "media", "page"] {
            let refused = world.issue_as_agent(&asked, used).await.unwrap_err();
            assert_eq!(
                refused.code,
                Code::Forbidden,
                "{} as {used}",
                asked.display()
            );
        }
    }
}

/// As `realpath` did: a link is followed once, as the token is given, to
/// the file it leads to, which the token then serves through no link.
#[cfg(unix)]
#[tokio::test]
async fn a_link_is_followed_as_the_token_is_given_and_its_file_served() {
    let world = World::new().await;
    let outside = world.outside();
    std::os::unix::fs::symlink(&outside, world.folder.join("out")).unwrap();
    std::os::unix::fs::symlink(outside.join("secret.png"), world.folder.join("leak.png")).unwrap();
    for asked in ["out/secret.png", "leak.png"] {
        let issued = world.issue(asked, "media").await.unwrap();
        assert_eq!(world.bytes(&issued.token).await.body, "secret", "{asked}");
    }
}

#[tokio::test]
async fn a_file_put_in_the_place_of_a_tokens_file_is_not_served() {
    let world = World::new().await;
    for name in ["image.png", "notes.txt"] {
        let path = world.write(name, "original");
        let issued = world.issue(name, "file").await.unwrap();
        assert_eq!(world.bytes(&issued.token).await.status, StatusCode::OK);
        std::fs::rename(&path, world.folder.join(format!("original {name}"))).unwrap();
        std::fs::write(&path, "replacement").unwrap();
        assert_eq!(
            world.bytes(&issued.token).await.status,
            StatusCode::NOT_FOUND
        );
        // Put back, the file it was given for is served again.
        std::fs::remove_file(&path).unwrap();
        std::fs::rename(world.folder.join(format!("original {name}")), &path).unwrap();
        assert_eq!(world.bytes(&issued.token).await.body, "original");
    }
}

#[cfg(unix)]
#[tokio::test]
async fn a_path_led_through_a_link_to_the_tokens_own_file_is_not_served() {
    let world = World::new().await;
    for name in ["image.png", "notes.txt"] {
        let path = world.write(name, "original");
        let issued = world.issue(name, "file").await.unwrap();
        let moved = world.folder.join(format!("original {name}"));
        std::fs::rename(&path, &moved).unwrap();
        std::os::unix::fs::symlink(&moved, &path).unwrap();
        assert_eq!(
            world.bytes(&issued.token).await.status,
            StatusCode::NOT_FOUND
        );
        // A folder on the way made a link: the same.
        let deep = world.write(&format!("deep/{name}"), "deep");
        let issued = world.issue(&deep, "file").await.unwrap();
        std::fs::rename(world.folder.join("deep"), world.folder.join("real")).unwrap();
        std::os::unix::fs::symlink(world.folder.join("real"), world.folder.join("deep")).unwrap();
        assert_eq!(
            world.bytes(&issued.token).await.status,
            StatusCode::NOT_FOUND
        );
        std::fs::remove_file(world.folder.join("deep")).unwrap();
        std::fs::remove_dir_all(world.folder.join("real")).unwrap();
    }
}

#[cfg(unix)]
#[tokio::test]
async fn a_link_out_of_the_project_put_in_the_place_of_a_tokens_file_is_not_served() {
    let world = World::new().await;
    let outside = world.outside();
    let path = world.write("image.png", "original");
    let issued = world.issue("image.png", "media").await.unwrap();
    std::fs::remove_file(&path).unwrap();
    std::os::unix::fs::symlink(outside.join("secret.png"), &path).unwrap();
    let answer = world.bytes(&issued.token).await;
    assert_eq!(answer.status, StatusCode::NOT_FOUND);
    assert_eq!(answer.body, "Not found");
}

#[tokio::test]
async fn any_file_is_read_in_ranges_and_one_past_its_end_is_refused_with_its_size() {
    let world = World::new().await;
    world.write("log.txt", "0123456789");
    let issued = world.issue("log.txt", "file").await.unwrap();
    let tail = world.range(&issued.token, "bytes=-4").await;
    assert_eq!(tail.status, StatusCode::PARTIAL_CONTENT);
    assert_eq!(tail.header(header::CONTENT_RANGE), Some("bytes 6-9/10"));
    assert_eq!(tail.header(header::CONTENT_LENGTH), Some("4"));
    assert_eq!(tail.body, "6789");
    for range in ["bytes=10-", "bytes=0-1,3-4", "rows=1-2"] {
        let past = world.range(&issued.token, range).await;
        assert_eq!(past.status, StatusCode::RANGE_NOT_SATISFIABLE, "{range}");
        assert_eq!(past.header(header::CONTENT_RANGE), Some("bytes */10"));
        assert_eq!(past.body, "");
    }
}

#[tokio::test]
async fn a_large_file_is_served_whole_and_from_far_in() {
    let world = World::new().await;
    let text: String = (0..300_000)
        .map(|n| char::from(b'a' + (n % 26) as u8))
        .collect();
    world.write("big.txt", &text);
    let issued = world.issue("big.txt", "file").await.unwrap();
    assert_eq!(world.bytes(&issued.token).await.body, text);
    let far = world.range(&issued.token, "bytes=262140-262149").await;
    assert_eq!(far.body, text[262_140..262_150]);
}

#[tokio::test]
async fn a_page_is_served_into_a_frame_sandboxed_with_nothing_from_the_network() {
    let world = World::new().await;
    world.write("index.html", "<p>hi</p><script>parent.document</script>");
    let issued = world.issue("index.html", "page").await.unwrap();
    let shown = world.page(&issued.token).await;
    assert_eq!(shown.status, StatusCode::OK);
    assert_eq!(
        shown.header(header::CONTENT_TYPE),
        Some("text/html; charset=utf-8")
    );
    assert_eq!(
        shown.header(header::X_CONTENT_TYPE_OPTIONS),
        Some("nosniff")
    );
    assert_eq!(
        shown.header("cross-origin-resource-policy"),
        Some("same-origin")
    );
    assert_eq!(shown.header(header::REFERRER_POLICY), Some("no-referrer"));
    assert_eq!(shown.header(header::ACCESS_CONTROL_ALLOW_ORIGIN), None);
    assert!(shown.body.contains("<p>hi</p>"));

    let csp = shown.header(header::CONTENT_SECURITY_POLICY).unwrap();
    assert_eq!(csp, PAGE_CSP);
    let rules: std::collections::HashMap<&str, String> = csp
        .split("; ")
        .map(|rule| {
            let (name, values) = rule.split_once(' ').unwrap_or((rule, ""));
            (name, values.to_owned())
        })
        .collect();
    assert_eq!(rules["default-src"], "'none'");
    assert_eq!(rules["img-src"], "app://files data:");
    assert_eq!(rules["style-src"], "'unsafe-inline'");
    // Scripts run, but only in the sandbox: never on an origin of its own,
    // so the page cannot open the API, which a page of this machine's may.
    assert_eq!(rules["sandbox"], "allow-scripts");
    assert!(!csp.contains("allow-same-origin"));
    assert!(!rules.contains_key("connect-src"));
}

#[tokio::test]
async fn a_page_goes_to_a_frame_alone_never_to_a_pages_fetch_a_picture_or_a_window() {
    let world = World::new().await;
    world.write("index.html", "<p>hi</p>");
    let token = world.issue("index.html", "page").await.unwrap().token;
    let refused: [&[(&str, &str)]; 6] = [
        // Banda's page fetching it, or a picture of it.
        &[("accept", "*/*"), ("origin", "app://banda")],
        &[FRAME[0], FRAME[1], ("origin", "app://banda")],
        &[("accept", "image/*")],
        // Where Chromium says what for: a page's fetch, a window's page.
        &[("sec-fetch-mode", "cors"), ("sec-fetch-dest", "empty")],
        &[
            FRAME[0],
            FRAME[1],
            ("sec-fetch-mode", "navigate"),
            ("sec-fetch-dest", "document"),
        ],
        // Who says nothing.
        &[],
    ];
    for headers in refused {
        let answer = world.get("p", &token, headers).await;
        assert_eq!(answer.status, StatusCode::NOT_FOUND, "{headers:?}");
    }
    assert_eq!(world.page(&token).await.status, StatusCode::OK);
    let framed = [("sec-fetch-mode", "navigate"), ("sec-fetch-dest", "iframe")];
    assert_eq!(world.get("p", &token, &framed).await.status, StatusCode::OK);
}

#[tokio::test]
async fn pages_alone_are_served_as_pages_an_svg_document_too() {
    let world = World::new().await;
    world.write("logo.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>");
    world.write("notes.txt", "secret");
    let svg = world.issue("logo.svg", "page").await.unwrap();
    let shown = world.page(&svg.token).await;
    assert_eq!(shown.header(header::CONTENT_TYPE), Some("image/svg+xml"));
    assert_eq!(world.refused("notes.txt", "page").await, Code::Invalid);
}

#[cfg(unix)]
#[tokio::test]
async fn no_page_is_served_by_a_link_to_another_kind() {
    let world = World::new().await;
    world.write("notes.txt", "secret");
    std::os::unix::fs::symlink(
        world.folder.join("notes.txt"),
        world.folder.join("notes.html"),
    )
    .unwrap();
    assert_eq!(world.refused("notes.html", "page").await, Code::Invalid);
}

#[tokio::test]
async fn a_token_of_one_route_is_not_the_others() {
    let world = World::new().await;
    world.write("index.html", "<p>hi</p>");
    let page = world.issue("index.html", "page").await.unwrap().token;
    assert_eq!(world.bytes(&page).await.status, StatusCode::NOT_FOUND);
    let bytes = world.issue("index.html", "file").await.unwrap().token;
    assert_eq!(world.page(&bytes).await.status, StatusCode::NOT_FOUND);
    let media = world.write("a.png", "png");
    let media = world.issue(&media, "media").await.unwrap().token;
    assert_eq!(world.page(&media).await.status, StatusCode::NOT_FOUND);
    // The byte route serves a page as its text, which runs nothing.
    let text = world.bytes(&bytes).await;
    assert_eq!(
        text.header(header::CONTENT_TYPE),
        Some("text/plain; charset=utf-8")
    );
}

#[tokio::test]
async fn a_modules_own_page_is_given_a_token_and_served_as_a_page_alone() {
    let world = World::new().await;
    // A page a module keeps, outside every Project's folder, as agents
    // keeps a Visual's.
    let kept = world.outside().join("visual.html");
    std::fs::write(&kept, "<p>shown</p>").unwrap();
    let before = banda_kernel::now_ms();
    let issued = world.bytes.page(kept.clone()).await.unwrap();
    assert_eq!(issued.token.len(), 64);
    assert!(issued.until >= before + HOUR, "an hour");
    let page = world.page(&issued.token).await;
    assert_eq!(page.status, StatusCode::OK);
    assert_eq!(page.body, "<p>shown</p>");
    assert_eq!(page.header(header::CONTENT_SECURITY_POLICY), Some(PAGE_CSP));
    assert_eq!(
        world.bytes(&issued.token).await.status,
        StatusCode::NOT_FOUND
    );
    // Another file put in its place is not served, as with any token.
    std::fs::remove_file(&kept).unwrap();
    std::fs::write(&kept, "<p>other</p>").unwrap();
    assert_eq!(
        world.page(&issued.token).await.status,
        StatusCode::NOT_FOUND
    );

    // No page: a file that is none, and one not there.
    let secret = world.outside().join("secret.png");
    let refused = world.bytes.page(secret).await.unwrap_err();
    assert_eq!(refused.code, Code::NotFound);
    let gone = world.outside().join("gone.html");
    let refused = world.bytes.page(gone).await.unwrap_err();
    assert_eq!(refused.code, Code::NotFound);
}

#[tokio::test]
async fn the_engines_api_still_answers_beside_its_bytes() {
    let world = World::new().await;
    let url = format!("http://{}/ws", world.address);
    let answer = world.asked(reqwest::Method::GET, &url, &[]).await;
    // A WebSocket's route: a plain GET is no upgrade, so it is refused.
    assert_ne!(answer.status, StatusCode::NOT_FOUND);
    assert!(answer.status.is_client_error(), "{}", answer.status);
}
