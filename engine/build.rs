use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

// Which Banda is built (ADR 0033, decision 1): `BANDA_CHANNEL` names it, and
// the folder its things go in comes from it (src/places.rs). A checkout is
// `local`; a name that is no channel stops the build.
fn main() {
    println!("cargo::rerun-if-env-changed=BANDA_CHANNEL");
    let channel = std::env::var("BANDA_CHANNEL").unwrap_or_default();
    let folder = match channel.as_str() {
        "stable" => "banda",
        "dev" => "banda-dev",
        "" | "local" => "banda-local",
        other => panic!("BANDA_CHANNEL is stable, dev or local, not {other:?}."),
    };
    println!("cargo::rustc-env=BANDA_FOLDER={folder}");

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

/// The file an App or a platform part declares itself in (ADR 0022). It
/// becomes `app.toml` (ADR 0062, decision 11) in one move with the
/// window's tests, which find the folders by this name too.
const MANIFEST: &str = "module.toml";

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

/// An App's or a platform part's folder, as the scan finds it.
struct Part {
    id: String,
    manifest: PathBuf,
    /// Its window part as the window's tests copy it, when it has one.
    window: Option<PathBuf>,
    /// Its engine part's crate's name, when it has one.
    engine: Option<String>,
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
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("..")
        .canonicalize()
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
        let window = match &part.window {
            Some(path) => format!("Some(include_str!({}))", literal(path)),
            None => "None".to_owned(),
        };
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
    write!(
        out,
        "];\n\n\
         /// The window's own part, a client's and no App's (ADR 0071,\n\
         /// decision 2): its manifest, and its actions, the tiling's, which\n\
         /// come after the Apps'.\n\
         pub const WINDOW: Part = Part {{\n    \
             id: \"window\",\n    \
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
    Part {
        manifest,
        window: Some(folder.join("window.json")).filter(|path| path.is_file()),
        engine,
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
