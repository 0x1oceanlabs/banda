//! The machine's tabs (ADR 0132): what the tools do with no window open,
//! through a driver of the test's own, `driver.mjs`, which speaks the
//! driver's lines on the Node on PATH and has no Chromium. The last test
//! runs the real driver on a real Chromium, by hand.

use super::{agent, answer, ask, open_with, project, window};
use banda_browser::Browser;
use banda_browser::chromium::{Chromium, Pin};
use banda_kernel::host::Node;
use banda_kernel::{AgentId, Caller, Code, Kernel, Participant, PersonId, ProjectId, Refusal};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// The Chromium the tests' driver is started for: it runs none.
const CHROMIUM: &str = "/the/test/s/chrome-headless-shell";

const NO_TAB: &str = "There is no tab 100001: browser_tabs lists them.";

/// The Node on PATH, which runs the tests' driver.
fn node() -> Node {
    let path = banda_kernel::host::path();
    Node {
        program: banda_kernel::host::find("node", &path).expect("node is on PATH"),
        electron: false,
    }
}

/// A machine with no window: its kernel, a Project in it, and the folder
/// its driver is in.
struct Machine {
    root: tempfile::TempDir,
    owner: PersonId,
    kernel: Arc<Kernel>,
    project: ProjectId,
}

impl Machine {
    async fn new() -> Machine {
        Self::on(node()).await
    }

    async fn on(node: Node) -> Machine {
        let root = tempfile::tempdir().unwrap();
        let driver = root.path().join("driver");
        std::fs::create_dir_all(&driver).unwrap();
        std::fs::write(
            driver.join("browser-driver.mjs"),
            include_str!("driver.mjs"),
        )
        .unwrap();
        let browser = Browser::new()
            .chromium(Chromium::at(CHROMIUM.into()))
            .driven_by(Some(node), vec![root.path().join("none"), driver])
            .config_in(root.path().join("config"));
        Self::with(root, browser).await
    }

    async fn with(root: tempfile::TempDir, browser: Browser) -> Machine {
        let owner = PersonId::new();
        let (kernel, project) = open_with(root.path(), owner, browser).await;
        Machine {
            root,
            owner,
            kernel,
            project,
        }
    }

    /// An Agent of the Project calls `method`.
    async fn call(&self, method: &str, params: Value) -> Result<Value, Refusal> {
        self.call_in(self.project, method, params).await
    }

    /// An Agent of `project` calls `method`.
    async fn call_in(
        &self,
        project: ProjectId,
        method: &str,
        params: Value,
    ) -> Result<Value, Refusal> {
        (self.kernel)
            .call(agent(project), method, None, None, params)
            .await
    }

    /// What `method` says, as a text.
    async fn said(&self, method: &str, params: Value) -> String {
        let said = self.call(method, params).await.unwrap();
        said.as_str().unwrap().to_owned()
    }

    /// A new machine's tab at `url`, by its id.
    async fn open(&self, url: &str) -> u64 {
        let said = self.said("browser.open", json!({ "url": url })).await;
        let id = said.strip_prefix("Opened tab ").unwrap();
        id.split_once('.').unwrap().0.parse().unwrap()
    }

    /// What the machine's `browser.toml` says from now on.
    fn settings(&self, text: &str) {
        let config = self.root.path().join("config");
        std::fs::create_dir_all(&config).unwrap();
        std::fs::write(config.join("browser.toml"), text).unwrap();
    }

    /// Each line the driver heard, and how each driver was started.
    fn heard(&self) -> Vec<Value> {
        let heard = self.root.path().join("driver/heard.jsonl");
        let Ok(heard) = std::fs::read_to_string(heard) else {
            return Vec::new();
        };
        (heard.lines())
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    /// The methods the driver was asked, in order.
    fn asked(&self) -> Vec<String> {
        (self.heard().iter())
            .filter_map(|line| Some(line["method"].as_str()?.to_owned()))
            .collect()
    }
}

fn refused(answer: Result<Value, Refusal>, code: Code, message: &str) {
    let refused = answer.unwrap_err();
    assert_eq!((refused.code, refused.message.as_str()), (code, message));
}

#[tokio::test]
async fn with_no_window_a_tab_opens_on_the_machine_and_its_calls_ask_the_driver() {
    let machine = Machine::new().await;
    let tabs = machine.call("browser.tabs", Value::Null).await.unwrap();
    assert_eq!(tabs, json!([]));
    assert!(machine.heard().is_empty(), "a list starts no driver");

    let by = AgentId::new();
    let opened = (machine.kernel)
        .call(
            Caller::agent(by, machine.project),
            "browser.open",
            None,
            None,
            json!({ "url": "http://localhost:5173/a" }),
        )
        .await
        .unwrap();
    assert_eq!(
        opened,
        "Opened tab 100001. Tab 100001 shows http://localhost:5173/a, titled \"Page\"."
    );
    let heard = machine.heard();
    assert_eq!(
        heard[0],
        json!({ "started": ["--chromium", CHROMIUM, "--first-tab", "100001"], "electron": null })
    );
    assert_eq!(heard[1]["method"], "open");
    let params = &heard[1]["params"];
    assert_eq!(params["url"], "http://localhost:5173/a");
    assert_eq!(params["by"], json!(by));
    // The Project's own profile, under its data on this machine.
    let profile = Path::new(params["profile"].as_str().unwrap());
    assert!(profile.ends_with("browser/profile"), "{profile:?}");
    assert!(
        profile
            .to_string_lossy()
            .contains(&machine.project.to_string()),
        "{profile:?}"
    );
    assert!(Path::new(params["downloads"].as_str().unwrap()).is_absolute());

    // Every later call on the tab asks the driver, and answers as a
    // window's tab does.
    let tab = json!({ "tab": 100_001 });
    let said = machine.said("browser.snapshot", tab.clone()).await;
    assert!(said.starts_with("Page: http://localhost:5173/a\nTitle: Page\n"));
    assert!(said.ends_with("- button \"Go\" [ref=e2]"));
    let to = json!({ "tab": 100_001, "to": "http://localhost:5173/b" });
    assert_eq!(
        machine.said("browser.navigate", to).await,
        "Went to the address. Tab 100001 shows http://localhost:5173/b, titled \"Page\"."
    );
    let click = json!({ "tab": 100_001, "action": "click", "ref": "e2" });
    assert_eq!(machine.said("browser.act", click).await, "Clicked e2.");
    let wait = json!({ "tab": 100_001, "text": "Done", "seconds": 600 });
    assert_eq!(
        machine.said("browser.wait_for", wait).await,
        "The page shows \"Done\". Tab 100001 shows http://localhost:5173/b, titled \"Page\"."
    );
    let waited = machine.heard().pop().unwrap();
    assert_eq!(waited["params"]["seconds"], 60);
    // A blank tab is the next one.
    assert_eq!(
        machine.said("browser.open", json!({})).await,
        "Opened tab 100002. Tab 100002 shows about:blank, titled \"Page\"."
    );
    assert_eq!(
        machine.call("browser.tabs", Value::Null).await.unwrap(),
        json!([
            { "id": 100_001, "url": "http://localhost:5173/b", "title": "Page", "driven": false, "lent": false },
            { "id": 100_002, "url": "about:blank", "title": "Page", "driven": false, "lent": false },
        ])
    );
    // One driver did it all.
    let starts = machine
        .heard()
        .iter()
        .filter(|line| line["started"].is_array())
        .count();
    assert_eq!(starts, 1);
}

#[tokio::test]
async fn with_a_window_a_tab_opens_in_it_and_each_tab_stays_where_it_opened() {
    let machine = Machine::new().await;
    let (kernel, project) = (&machine.kernel, machine.project);
    assert_eq!(machine.open("http://localhost/").await, 100_001);

    // A window opens: the next tab is its own.
    let mut hear = window(kernel, machine.owner).await;
    let opening = ask(kernel, project, "browser.open", json!({}));
    let asked = hear.recv().await.unwrap();
    assert_eq!(asked["method"], "browser.open");
    answer(
        kernel,
        machine.owner,
        &asked,
        json!(super::shown("", false)),
    )
    .await;
    let opened = opening.await.unwrap().unwrap();
    assert!(opened.as_str().unwrap().starts_with("Opened tab 9."));
    assert_eq!(machine.asked(), ["open"], "the driver heard of one tab");

    // The machine's tab is the driver's still, and the window's its own.
    let said = machine
        .said("browser.snapshot", json!({ "tab": 100_001 }))
        .await;
    assert!(said.starts_with("Page: http://localhost/\n"));
    let reading = ask(kernel, project, "browser.snapshot", json!({ "tab": 9 }));
    let asked = hear.recv().await.unwrap();
    assert_eq!(asked["method"], "browser.snapshot");
    let read = super::read("Example", "- main".into(), Vec::new());
    answer(kernel, machine.owner, &asked, json!(read)).await;
    let said = reading.await.unwrap().unwrap();
    assert!(
        said.as_str()
            .unwrap()
            .starts_with("Page: https://example.com/\n")
    );

    // The list has both: the window's first.
    let listing = ask(kernel, project, "browser.tabs", Value::Null);
    let asked = hear.recv().await.unwrap();
    assert_eq!(asked["method"], "browser.tabs");
    let theirs = json!({ "id": 7, "url": "https://example.com/", "title": "Example", "driven": true, "lent": true });
    answer(kernel, machine.owner, &asked, json!([theirs])).await;
    let ours = json!({ "id": 100_001, "url": "http://localhost/", "title": "Page", "driven": false, "lent": false });
    assert_eq!(listing.await.unwrap().unwrap(), json!([theirs, ours]));

    // The window closed: its tabs went with it, the machine's did not.
    drop(hear);
    refused(
        machine.call("browser.snapshot", json!({ "tab": 9 })).await,
        Code::NotFound,
        "There is no tab 9: browser_tabs lists them.",
    );
    assert_eq!(
        machine.call("browser.tabs", Value::Null).await.unwrap(),
        json!([ours])
    );
}

#[tokio::test]
async fn an_agent_reaches_only_its_own_project_s_tabs_on_the_machine() {
    let machine = Machine::new().await;
    let other = project(&machine.kernel, machine.owner, "Home").await;
    assert_eq!(machine.open("http://localhost/").await, 100_001);
    let asked = machine.asked();

    let tab = json!({ "tab": 100_001 });
    for (method, params) in [
        ("browser.snapshot", tab.clone()),
        ("browser.screenshot", tab.clone()),
        (
            "browser.navigate",
            json!({ "tab": 100_001, "to": "reload" }),
        ),
        (
            "browser.act",
            json!({ "tab": 100_001, "action": "click", "ref": "e2" }),
        ),
        (
            "browser.wait_for",
            json!({ "tab": 100_001, "text": "Done" }),
        ),
        (
            "browser.handoff",
            json!({ "tab": 100_001, "why": "Sign in" }),
        ),
    ] {
        let answer = machine.call_in(other, method, params).await;
        refused(answer, Code::NotFound, NO_TAB);
    }
    let theirs = machine.call_in(other, "browser.tabs", Value::Null).await;
    assert_eq!(theirs.unwrap(), json!([]));
    // The driver heard of none of it but the list, of the other profile.
    let heard = machine.heard();
    assert_eq!(machine.asked()[asked.len()..], ["tabs"]);
    let listed = heard.last().unwrap()["params"]["profile"].as_str().unwrap();
    assert!(listed.contains(&other.to_string()), "{listed}");

    // Its own tab is another one, in a profile of its own.
    let opened = machine.call_in(other, "browser.open", json!({})).await;
    assert!(
        opened
            .unwrap()
            .as_str()
            .unwrap()
            .starts_with("Opened tab 100002.")
    );
    refused(
        machine
            .call("browser.snapshot", json!({ "tab": 100_002 }))
            .await,
        Code::NotFound,
        "There is no tab 100002: browser_tabs lists them.",
    );
}

#[tokio::test]
async fn a_tab_a_page_opens_is_its_project_s_too() {
    let machine = Machine::new().await;
    let other = project(&machine.kernel, machine.owner, "Home").await;
    machine.open("http://localhost/").await;
    let click = json!({ "tab": 100_001, "action": "click", "ref": "popup" });
    assert_eq!(
        machine.said("browser.act", click).await,
        "Clicked popup. It opened tab 100002, at https://popup.test/."
    );
    let to = json!({ "tab": 100_002, "to": "http://localhost/next" });
    refused(
        machine.call_in(other, "browser.navigate", to.clone()).await,
        Code::NotFound,
        "There is no tab 100002: browser_tabs lists them.",
    );
    assert!(
        machine
            .said("browser.navigate", to)
            .await
            .starts_with("Went to the address.")
    );
}

#[tokio::test]
async fn the_person_s_switches_hold_for_a_machine_s_tab() {
    let machine = Machine::new().await;
    machine.open("http://localhost/").await;
    let tab = json!({ "tab": 100_001 });

    // Pictures are off until the Person turns them on.
    let no_pictures = "Page screenshots are disabled. The Person can enable agents.screenshots in Settings → Browser.";
    refused(
        machine.call("browser.screenshot", tab.clone()).await,
        Code::Forbidden,
        no_pictures,
    );
    assert_eq!(machine.asked(), ["open"], "the driver took none");
    machine.settings("[agents]\nscreenshots = true\n");
    assert_eq!(
        machine
            .call("browser.screenshot", tab.clone())
            .await
            .unwrap(),
        json!({ "tab": 100_001, "url": "http://localhost/", "title": "Page", "width": 2, "height": 1, "pictures": [{ "mime": "image/jpeg", "data": "/9j/" }] })
    );

    // Turned off, the tools refuse the next call, on a tab open already.
    machine.settings("[agents]\nenabled = false\nscreenshots = true\n");
    let asked = machine.asked();
    let off = "Banda's browser tools are disabled in Settings → Browser.";
    for (method, params) in [
        ("browser.tabs", Value::Null),
        ("browser.open", json!({})),
        ("browser.snapshot", tab.clone()),
        ("browser.screenshot", tab.clone()),
        ("browser.navigate", json!({ "tab": 100_001, "to": "back" })),
        (
            "browser.act",
            json!({ "tab": 100_001, "action": "hover", "ref": "e2" }),
        ),
        ("browser.wait_for", json!({ "tab": 100_001, "ref": "e2" })),
    ] {
        refused(machine.call(method, params).await, Code::Forbidden, off);
    }
    assert_eq!(machine.asked(), asked, "the driver heard of none of it");
}

#[tokio::test]
async fn an_agent_uses_a_site_on_the_machine_only_once_its_person_allows_it() {
    let machine = Machine::new().await;
    machine.settings("[agents]\nscreenshots = true\n");
    // A tab opens and goes anywhere on the web: that reads nothing.
    assert_eq!(machine.open("https://docs.example.com/a").await, 100_001);
    let to = json!({ "tab": 100_001, "to": "https://gist.github.com/b" });
    machine.said("browser.navigate", to).await;

    let tab = json!({ "tab": 100_001 });
    let each = || {
        [
            ("browser.snapshot", tab.clone()),
            ("browser.screenshot", tab.clone()),
            (
                "browser.act",
                json!({ "tab": 100_001, "action": "click", "ref": "e2" }),
            ),
            (
                "browser.act",
                json!({ "tab": 100_001, "action": "dialog_accept", "dialog": "d1" }),
            ),
            (
                "browser.wait_for",
                json!({ "tab": 100_001, "text": "Done" }),
            ),
        ]
    };
    let not_yet = "Tab 100001 is on github.com, which you may not use yet. Your Person allows it \
                   in Settings → Browser, or with `banda settings set browser.toml \
                   'agents.sites.\"github.com\"' allow`: tell them why you need it.";
    for (method, params) in each() {
        refused(machine.call(method, params).await, Code::Forbidden, not_yet);
    }
    // The driver was asked only where the tab is.
    let asked = machine.asked();
    assert_eq!(asked[..2], ["open", "navigate"]);
    assert!(
        asked[2..].iter().all(|method| method == "where"),
        "{asked:?}"
    );

    // Their yes for the site covers its hosts.
    machine.settings("[agents]\nscreenshots = true\n[agents.sites]\n\"github.com\" = \"allow\"\n");
    for (method, params) in each() {
        machine.call(method, params).await.unwrap();
    }
    // A no for one host of it holds over the site's yes.
    machine.settings(
        "[agents]\nscreenshots = true\n[agents.sites]\n\"github.com\" = \"allow\"\n\"gist.github.com\" = \"deny\"\n",
    );
    let denied = "The Person lets no Agent use github.com. Do not use it: carry on without it, \
                  or tell them why you need it.";
    for (method, params) in each() {
        refused(machine.call(method, params).await, Code::Forbidden, denied);
    }
    // The Person is asked nothing of their own machine's tab.
    let read = (machine.kernel).call(
        Participant::Person(machine.owner),
        "browser.snapshot",
        Some(machine.project),
        None,
        tab.clone(),
    );
    assert!(read.await.is_ok());
}

#[tokio::test]
async fn a_machine_s_tab_is_not_handed_to_the_person_yet() {
    let machine = Machine::new().await;
    machine.open("http://localhost/").await;
    let hand = json!({ "tab": 100_001, "why": "Sign in to GitHub" });
    refused(
        machine.call("browser.handoff", hand).await,
        Code::Conflict,
        "Your Person cannot see this tab yet. Say what you need from them in your message instead.",
    );
    assert_eq!(machine.asked(), ["open"]);
}

#[tokio::test]
async fn a_tab_the_driver_has_no_more_is_no_machine_s_tab() {
    let machine = Machine::new().await;
    machine.open("http://localhost/").await;
    let gone = json!({ "tab": 100_001, "action": "press", "key": "Gone" });
    refused(
        machine.call("browser.act", gone).await,
        Code::NotFound,
        NO_TAB,
    );
    let asked = machine.asked();
    // The engine forgot it: the driver is not asked of it again.
    let read = machine
        .call("browser.snapshot", json!({ "tab": 100_001 }))
        .await;
    refused(read, Code::NotFound, NO_TAB);
    assert_eq!(machine.asked(), asked);
}

#[tokio::test]
async fn a_driver_that_ends_refuses_what_waited_and_the_next_call_starts_another() {
    let machine = Machine::new().await;
    assert_eq!(machine.open("http://localhost/").await, 100_001);
    assert_eq!(machine.open("http://localhost/").await, 100_002);

    // It ends under an action, which may have been done.
    let die = json!({ "tab": 100_002, "action": "press", "key": "Die" });
    refused(
        machine.call("browser.act", die).await,
        Code::MayHaveRun,
        "Banda's browser stopped before it answered, and its tabs closed with it. What was \
         asked may have been done.",
    );
    // Its tabs went with it.
    let read = machine
        .call("browser.snapshot", json!({ "tab": 100_001 }))
        .await;
    refused(read, Code::NotFound, NO_TAB);
    assert_eq!(
        machine.call("browser.tabs", Value::Null).await.unwrap(),
        json!([])
    );

    // The next tab starts another driver, and no id comes twice.
    assert_eq!(machine.open("http://localhost/die").await, 100_003);
    let started: Vec<Value> = (machine.heard().into_iter())
        .filter(|line| line["started"].is_array())
        .collect();
    assert_eq!(started.len(), 2);
    assert_eq!(started[1]["started"][3], "100003");

    // It ends under a read, which did nothing.
    let read = machine
        .call("browser.snapshot", json!({ "tab": 100_003 }))
        .await;
    refused(
        read,
        Code::Conflict,
        "Banda's browser stopped before it answered, and its tabs closed with it. Open a tab \
         again.",
    );
    assert_eq!(machine.open("http://localhost/").await, 100_004);
}

#[tokio::test]
async fn a_driver_that_does_not_answer_in_time_is_refused_as_the_window_is() {
    let machine = Machine::new().await;
    machine.open("http://localhost/").await;
    // The clock runs on by itself from here, while nothing else can.
    tokio::time::pause();
    let to = json!({ "tab": 100_001, "to": "http://localhost/hang" });
    refused(
        machine.call("browser.navigate", to).await,
        Code::MayHaveRun,
        "Banda's browser did not answer within 40 s. What was asked may have been done.",
    );
}

#[tokio::test]
async fn an_electron_runs_the_driver_as_node() {
    let electron = Node {
        electron: true,
        ..node()
    };
    let machine = Machine::on(electron).await;
    machine.open("http://localhost/").await;
    assert_eq!(machine.heard()[0]["electron"], "1");
}

#[tokio::test]
async fn a_banda_that_carries_no_driver_or_has_no_node_says_so() {
    let no_driver = |root: &Path| {
        Browser::new()
            .chromium(Chromium::at(CHROMIUM.into()))
            .driven_by(Some(node()), vec![root.join("none")])
    };
    let no_node = |root: &Path| {
        std::fs::write(root.join("browser-driver.mjs"), "").unwrap();
        Browser::new()
            .chromium(Chromium::at(CHROMIUM.into()))
            .driven_by(None, vec![root.to_owned()])
    };
    for browser in [&no_driver as &dyn Fn(&Path) -> Browser, &no_node] {
        let root = tempfile::tempdir().unwrap();
        let browser = browser(root.path());
        let machine = Machine::with(root, browser).await;
        refused(
            machine.call("browser.open", json!({})).await,
            Code::AppUnavailable,
            "This Banda does not carry its browser for Agents yet.",
        );
    }
}

#[tokio::test]
async fn a_chromium_that_is_not_ready_refuses_in_its_own_words_and_no_driver_starts() {
    let root = tempfile::tempdir().unwrap();
    let driver = root.path().join("driver");
    std::fs::create_dir_all(&driver).unwrap();
    std::fs::write(
        driver.join("browser-driver.mjs"),
        include_str!("driver.mjs"),
    )
    .unwrap();
    // A system Banda has no Chromium for.
    let chromium = Chromium::pinned(&root.path().join("data"), Pin::ours(), None);
    let browser = Browser::new()
        .chromium(Arc::new(chromium))
        .driven_by(Some(node()), vec![driver]);
    let machine = Machine::with(root, browser).await;
    refused(
        machine.call("browser.open", json!({})).await,
        Code::AppUnavailable,
        "Banda has no browser for Agents on this system yet.",
    );
    assert!(machine.heard().is_empty());
}

/// Serves `body` as a page to every request, and answers where.
async fn served(body: &'static str) -> String {
    use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let at = format!("http://{}/", listener.local_addr().unwrap());
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut asked = [0; 4096];
                let _ = socket.read(&mut asked).await;
                let head = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                    body.len()
                );
                let _ = socket.write_all(head.as_bytes()).await;
                let _ = socket.write_all(body.as_bytes()).await;
            });
        }
    });
    at
}

/// The real driver on a real Chromium, by hand, once the driver is built
/// (`pnpm --filter @banda/browser-driver build`):
/// `BANDA_CHROMIUM=<chrome-headless-shell> cargo test -p banda-browser
/// --test browser live -- --ignored --nocapture`. Chromium runs in its
/// sandbox, as always: on a system that keeps it from that program, the
/// tab does not open, and the refusal says so.
#[tokio::test]
#[ignore = "runs the built driver on the Chromium BANDA_CHROMIUM names"]
async fn live_an_agent_opens_a_page_on_the_machine_and_reads_it() {
    let chromium = PathBuf::from(std::env::var("BANDA_CHROMIUM").unwrap());
    let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("../driver/dist");
    let browser = Browser::new()
        .chromium(Chromium::at(chromium))
        .driven_by(Some(node()), vec![dist]);
    let machine = Machine::with(tempfile::tempdir().unwrap(), browser).await;
    let at = served("<title>Live</title><h1>Banda reads this</h1><button>Go</button>").await;

    let opened = machine.said("browser.open", json!({ "url": at })).await;
    assert_eq!(
        opened,
        format!("Opened tab 100001. Tab 100001 shows {at}, titled \"Live\".")
    );
    let said = machine
        .said("browser.snapshot", json!({ "tab": 100_001 }))
        .await;
    assert!(said.contains("Banda reads this"), "{said}");
    assert!(said.contains("- button \"Go\" [ref="), "{said}");
    let tabs = machine.call("browser.tabs", Value::Null).await.unwrap();
    assert_eq!(tabs[0]["title"], "Live");
}
