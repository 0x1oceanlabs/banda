use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

// Which Banda is built (ADR 0033, decision 1): `BANDA_CHANNEL` names it, and
// the folder its things go in comes from it (src/places.rs). A checkout is
// `local`; a name that is no channel stops the build.
fn main() {
    println!("cargo::rerun-if-env-changed=BANDA_CHANNEL");
    let channel = std::env::var("BANDA_CHANNEL").unwrap_or_default();
    // The app's bundle ID beside it, as the window's channel.ts names it:
    // macOS knows Banda's launchd job by it (src/service/launchd.rs).
    let (folder, app_id) = match channel.as_str() {
        "stable" => ("banda", "so.banda.app"),
        "dev" => ("banda-dev", "so.banda.dev"),
        "" | "local" => ("banda-local", "so.banda.local"),
        other => panic!("BANDA_CHANNEL is stable, dev or local, not {other:?}."),
    };
    println!("cargo::rustc-env=BANDA_FOLDER={folder}");
    println!("cargo::rustc-env=BANDA_APP_ID={app_id}");

    // Its version (decision 2): 0.X.Y or 0.X.Y-dev.N, or the workspace's.
    println!("cargo::rerun-if-env-changed=BANDA_VERSION");
    let version = std::env::var("BANDA_VERSION")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| std::env::var("CARGO_PKG_VERSION").unwrap());
    println!("cargo::rustc-env=BANDA_VERSION={version}");

    // Each build is known by its build id (ADR 0086, decision 2). A Mach-O
    // always has its UUID; an ELF has a build id only when the linker is
    // asked for one, as most toolchains ask by default, so `banda` asks.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        println!("cargo::rustc-link-arg-bins=-Wl,--build-id=sha1");
    }

    // One list of Apps (ADR 0062, decision 11).
    apps();
}

/// The file an App or a platform part declares itself in (ADR 0022),
/// `app.toml` (ADR 0062, decision 11), which was `module.toml`. The
/// window's tests find the folders by this name alone too
/// (`MANIFEST_NAMES` in @banda/ui/testing/architecture). The window's own
/// part declares itself in `client/web/app.toml` too, though it is
/// neither an App nor a platform part (ADR 0087, decision 1).
const MANIFEST: &str = "app.toml";

/// The major of the App API this engine hosts (ADR 0062, decision 11;
/// ADR 0082, decision 14): each manifest names the one it is written to,
/// a whole number.
const API: i64 = 1;

/// The files that make a folder a part, each of which only a part has:
/// its engine part's crate, its packages in the window, and its window
/// part as the engine reads it.
const PART_FILES: &[&str] = &[
    "engine/Cargo.toml",
    "pane/package.json",
    "desktop/package.json",
    "window.json",
];

/// The parts with a window part, in the window's order: the Apps', then
/// the Tiling's, the workspaces' own, and the Window's own last (ADR 0071,
/// decision 2; ADR 0087, decision 13). The first action to take a key
/// keeps it, so the settings read the window parts in this order. A part
/// with a window part and no place here stops the build, and so does a
/// place with no such part.
const WINDOW_ORDER: [&str; 12] = [
    "agents",
    "terminal",
    "browser",
    "git",
    "files",
    "pulls",
    "harnesses",
    "notifications",
    "clock",
    "workspaces",
    "apps",
    WINDOW,
];

/// What a part with no settings files hands the settings, as Rust.
const NO_FILES: &str = "&[]";

/// The id of the Window's own part, a client's and no App's.
const WINDOW: &str = "window";

/// An App's or a platform part's folder, as the scan finds it.
struct Part {
    id: String,
    manifest: PathBuf,
    /// Its window part as the window's tests copy it, when it has one.
    window: Option<PathBuf>,
    /// Its engine part's crate's name, when it has one.
    engine: Option<String>,
    /// The settings files its manifest says it owns, as Rust: its engine
    /// part's crate's `SETTINGS`, or [`NO_FILES`].
    files: String,
    /// Its packages in the window: the page's and main's.
    pane: Option<String>,
    desktop: Option<String>,
    /// `apps` or `platform`.
    bucket: String,
}

/// One list of Apps (ADR 0082, decision 2): each folder of `apps/` and
/// `platform/` with a manifest, the Apps first, each bucket by its
/// folders' names. It writes `apps.rs`, which `src/apps.rs` includes: the
/// list, with each manifest and window part, and the engine parts the
/// engine serves, in its order. A manifest that says something wrong of
/// its folder stops the build.
fn apps() {
    let root =
        dunce::canonicalize(PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join(".."))
            .unwrap();
    let mut parts: Vec<Part> = Vec::new();
    for (bucket, kind) in [("apps", "app"), ("platform", "platform")] {
        let dir = root.join(bucket);
        // A folder added or gone, or a file anywhere in one changed: Cargo
        // looks through the whole folder.
        println!("cargo::rerun-if-changed={}", dir.display());
        let mut folders: Vec<PathBuf> = fs::read_dir(&dir)
            .unwrap_or_else(|error| panic!("{}: {error}", dir.display()))
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect();
        folders.sort();
        for folder in folders {
            // A folder with a part's files is a part, and declares itself
            // in its manifest. One of platform/ with none is a crate of
            // the platform's, as the look; one of apps/ with none is what
            // git leaves of a part moved or gone, as its ignored
            // `node_modules`.
            if !folder.join(MANIFEST).is_file() {
                if let Some(file) = PART_FILES.iter().find(|file| folder.join(file).is_file()) {
                    panic!(
                        "{}: it has {file}, so it is a part, and a part declares itself in its {MANIFEST}",
                        folder.display()
                    );
                }
                if bucket == "apps" {
                    println!(
                        "cargo::warning={}: no {MANIFEST} and no part's files, so no App: left from a part moved or gone?",
                        folder.display()
                    );
                }
                continue;
            }
            let part = part(bucket, kind, &folder);
            if parts.iter().any(|other| other.id == part.id) {
                panic!("two folders are the App {:?}", part.id);
            }
            parts.push(part);
        }
    }
    let window = root.join("client/web");
    for file in [MANIFEST, "window.json"] {
        println!("cargo::rerun-if-changed={}", window.join(file).display());
    }
    let engines: Vec<&Part> = parts.iter().filter(|part| part.engine.is_some()).collect();

    let mut out = format!(
        "// Written by build.rs from each App's manifest: do not edit.\n\n\
         /// The file each App and platform part declares itself in.\n\
         pub const MANIFEST: &str = {MANIFEST:?};\n\n\
         /// Every App, then the platform's parts, each by its folder's name.\n\
         pub const APPS: &[Part] = &[\n",
    );
    for part in &parts {
        let window = included(part.window.as_deref());
        let methods = match &part.engine {
            Some(_) => format!("Some(table_of(build::{}))", part.id),
            None => "None".to_owned(),
        };
        writeln!(
            out,
            "    Part {{\n        \
                 id: {id:?},\n        \
                 manifest: include_str!({manifest}),\n        \
                 window: {window},\n        \
                 methods: {methods},\n    \
             }},",
            id = part.id,
            manifest = literal(&part.manifest),
        )
        .unwrap();
    }
    out.push_str("];\n\n");
    handed(&mut out, &parts, &window.join("window.json"));
    write!(
        out,
        "\
         /// The window's own part, a client's and no App's (ADR 0071,\n\
         /// decision 2): its manifest, and its actions, the tiling's, which\n\
         /// come after the Apps'.\n\
         pub const WINDOW: Part = Part {{\n    \
             id: {WINDOW:?},\n    \
             manifest: include_str!({}),\n    \
             window: Some(include_str!({})),\n    \
             methods: None,\n\
         }};\n\n\
         /// Builds every engine part into the kernel, in the list's order.\n\
         pub fn serve(kernel: KernelBuilder, host: &HostContext<'_>) -> KernelBuilder {{\n    \
             kernel\n",
        literal(&window.join(MANIFEST)),
        literal(&window.join("window.json")),
    )
    .unwrap();
    for part in &engines {
        writeln!(out, "        .module(build::{}(host))", part.id).unwrap();
    }
    out.push_str(
        "}\n\n\
         /// What the scan found beside each manifest, for the tests that hold\n\
         /// the lists still kept by hand to the list.\n\
         #[cfg(test)]\n\
         pub(crate) mod scanned {\n    \
             use super::{HostContext, build, typed};\n\n    \
             /// Each engine part, as its builder makes it, by its App: for the\n    \
             /// tests that read what a part says of itself.\n    \
             pub fn parts(host: &HostContext<'_>) -> Vec<(&'static str, Box<dyn banda_kernel::Module>)> {\n        \
                 vec![\n",
    );
    for part in &engines {
        writeln!(
            out,
            "            ({id:?}, Box::new(build::{id}(host))),",
            id = part.id
        )
        .unwrap();
    }
    out.push_str(
        "        ]\n    }\n\n    \
         /// Each engine part's crate, by its App: its name and its folder.\n    \
         pub const CRATES: &[(&str, &str, &str)] = &[\n",
    );
    for part in &engines {
        let name = part.engine.as_ref().unwrap();
        writeln!(
            out,
            "        ({id:?}, {name:?}, {folder:?}),",
            id = part.id,
            folder = part.folder("engine"),
        )
        .unwrap();
    }
    out.push_str(
        "    ];\n\n    \
         /// Each engine part's methods as TypeScript, by its App: the type\n    \
         /// its `methods!` table writes, and the folder it writes it in.\n    \
         pub const TYPES: &[(&str, (&str, &str))] = &[\n",
    );
    for part in &engines {
        writeln!(out, "        ({id:?}, typed(build::{id})),", id = part.id).unwrap();
    }
    out.push_str(
        "    ];\n\n    \
         /// Each window part's package in the page, by its App.\n    \
         pub const PANES: &[(&str, &str)] = &[\n",
    );
    for part in &parts {
        if let Some(name) = &part.pane {
            writeln!(out, "        ({:?}, {name:?}),", part.id).unwrap();
        }
    }
    out.push_str(
        "    ];\n\n    \
         /// Each part's package in the window's main process, by its App.\n    \
         pub const DESKTOPS: &[(&str, &str)] = &[\n",
    );
    for part in &parts {
        if let Some(name) = &part.desktop {
            writeln!(out, "        ({:?}, {name:?}),", part.id).unwrap();
        }
    }
    out.push_str("    ];\n}\n");

    let file = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("apps.rs");
    if fs::read_to_string(&file).ok().as_deref() != Some(out.as_str()) {
        fs::write(&file, out).unwrap();
    }
}

/// A file there or not, as Rust: its text, or none.
fn included(file: Option<&Path>) -> String {
    match file {
        Some(path) => format!("Some(include_str!({}))", literal(path)),
        None => "None".to_owned(),
    }
}

/// Writes what each part hands the settings: the parts with a window
/// part in the window's order, then the rest with settings files, by the
/// scan's order.
fn handed(out: &mut String, parts: &[Part], window: &Path) {
    let with_window: Vec<&str> = parts
        .iter()
        .filter(|part| part.window.is_some())
        .map(|part| part.id.as_str())
        .chain([WINDOW])
        .collect();
    for id in &with_window {
        if !WINDOW_ORDER.contains(id) {
            panic!(
                "{id} has a window part, so build.rs's WINDOW_ORDER says where its actions come"
            );
        }
    }
    for id in WINDOW_ORDER {
        if !with_window.contains(&id) {
            panic!("build.rs's WINDOW_ORDER names {id}, which has no window part");
        }
    }
    out.push_str(
        "/// What each part hands the settings: its files and its window part.\n\
         /// The parts with a window part come first, in the window's order, the\n\
         /// Window's own last of them; then the rest that own settings files.\n\
         pub const HANDED: &[banda_settings::Part] = &[\n",
    );
    let ordered = WINDOW_ORDER.iter().map(|id| {
        let part = parts.iter().find(|part| part.id == *id);
        let json = part.map_or(window, |part| part.window.as_deref().unwrap());
        (*id, part, Some(json))
    });
    let rest = parts
        .iter()
        .filter(|part| part.window.is_none() && part.files != NO_FILES)
        .map(|part| (part.id.as_str(), Some(part), None));
    for (id, part, window) in ordered.chain(rest) {
        let files = part.map_or(NO_FILES, |part| &part.files);
        let window = included(window);
        writeln!(
            out,
            "    banda_settings::Part {{\n        \
                 id: {id:?},\n        \
                 files: {files},\n        \
                 window: {window},\n    \
             }},"
        )
        .unwrap();
    }
    out.push_str("];\n\n");
}

/// The part in `folder`, its manifest checked against where it is.
fn part(bucket: &str, kind: &str, folder: &Path) -> Part {
    let name = folder.file_name().unwrap().to_string_lossy().into_owned();
    let manifest = folder.join(MANIFEST);
    let shown = format!("{bucket}/{name}/{MANIFEST}");
    let text = fs::read_to_string(&manifest).unwrap_or_else(|error| panic!("{shown}: {error}"));
    let table: toml::Table =
        toml::from_str(&text).unwrap_or_else(|error| panic!("{shown}: {error}"));
    let said = |key: &str| table.get(key).and_then(toml::Value::as_str);

    if said("id") != Some(name.as_str()) {
        panic!("{shown}: its id is its folder's name, {name:?}");
    }
    if said("kind") != Some(kind) {
        panic!("{shown}: a part in {bucket}/ says kind = {kind:?} (ADR 0062, decision 11)");
    }
    if table.get("api").and_then(toml::Value::as_integer) != Some(API) {
        panic!("{shown}: this engine hosts the App API's major {API}, so it says api = {API}");
    }
    match table.get("needs") {
        Some(toml::Value::Table(needs)) if needs.is_empty() => {}
        _ => panic!(
            "{shown}: [needs] is there and empty, as nothing it could hold is built yet (ADR 0082, decision 2)"
        ),
    }

    let cargo = folder.join("engine/Cargo.toml");
    let engine = cargo.is_file().then(|| {
        let shown = format!("{bucket}/{name}/engine/Cargo.toml");
        let text = fs::read_to_string(&cargo).unwrap_or_else(|error| panic!("{shown}: {error}"));
        let table: toml::Table =
            toml::from_str(&text).unwrap_or_else(|error| panic!("{shown}: {error}"));
        (table.get("package"))
            .and_then(|package| package.get("name"))
            .and_then(toml::Value::as_str)
            .unwrap_or_else(|| panic!("{shown}: its [package] has a name"))
            .to_owned()
    });
    let owns = match table.get("settings") {
        None => false,
        Some(toml::Value::Array(files)) => !files.is_empty(),
        Some(_) => panic!("{shown}: settings is a list of its files' names"),
    };
    let files = match &engine {
        Some(name) if owns => format!("&{}::SETTINGS", name.replace('-', "_")),
        None if owns => {
            panic!("{shown}: it owns settings files, which its engine part's crate describes")
        }
        _ => NO_FILES.to_owned(),
    };
    Part {
        manifest,
        window: Some(folder.join("window.json")).filter(|path| path.is_file()),
        engine,
        files,
        pane: package(&folder.join("pane")),
        desktop: package(&folder.join("desktop")),
        bucket: bucket.to_owned(),
        id: name,
    }
}

impl Part {
    /// Its folder `sub`, from the repository's top.
    fn folder(&self, sub: &str) -> String {
        format!("{}/{}/{sub}", self.bucket, self.id)
    }
}

/// The name of the npm package in `folder`, when there is one.
fn package(folder: &Path) -> Option<String> {
    let file = folder.join("package.json");
    if !file.is_file() {
        return None;
    }
    let shown = file.display();
    let text = fs::read_to_string(&file).unwrap_or_else(|error| panic!("{shown}: {error}"));
    let json: serde_json::Value =
        serde_json::from_str(&text).unwrap_or_else(|error| panic!("{shown}: {error}"));
    let name = json["name"].as_str();
    Some(
        name.unwrap_or_else(|| panic!("{shown}: it has a name"))
            .to_owned(),
    )
}

/// `path` as a Rust string literal, for `include_str!`.
fn literal(path: &Path) -> String {
    format!("{:?}", path.display().to_string())
}
