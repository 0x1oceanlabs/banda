//! Gathers the skill's topics: every `skill/*.md` next to a part of Banda,
//! at the workspace's top (`engine/skill/`) or in `apps/` and `platform/`
//! (`platform/look/skill/`). A topic may include a file beside its code,
//! `<!-- include ../sidebar.toml -->`, so what it shows is what ships.

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    let crate_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .canonicalize()
        .unwrap();
    let root = crate_dir.join("../..").canonicalize().unwrap();
    let mut pages = Vec::new();
    for parent in [root.clone(), root.join("apps"), root.join("platform")] {
        println!("cargo:rerun-if-changed={}", parent.display());
        let Ok(entries) = fs::read_dir(&parent) else {
            continue;
        };
        for entry in entries.flatten() {
            let folder = entry.path().join("skill");
            // This crate is `platform/skill`, not a part's pages.
            if !folder.is_dir() || folder.canonicalize().unwrap() == crate_dir {
                continue;
            }
            println!("cargo:rerun-if-changed={}", folder.display());
            for page in fs::read_dir(&folder).unwrap().flatten() {
                let path = page.path();
                if path.extension().is_some_and(|e| e == "md") {
                    pages.push(path);
                }
            }
        }
    }
    pages.sort();

    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let mut list = String::from("&[\n");
    for (at, path) in pages.iter().enumerate() {
        println!("cargo:rerun-if-changed={}", path.display());
        let text = included(path);
        let file = out.join(format!("topic-{at}.md"));
        fs::write(&file, text).unwrap();
        let source = path.strip_prefix(&root).unwrap().display().to_string();
        writeln!(
            list,
            "    ({source:?}, include_str!({:?})),",
            file.display().to_string()
        )
        .unwrap();
    }
    list.push(']');
    fs::write(out.join("topics.rs"), list).unwrap();
}

/// The page, each `<!-- include path -->` line replaced by that file in a
/// fenced block, its language from its extension.
fn included(page: &Path) -> String {
    let text = fs::read_to_string(page).unwrap();
    let mut out = String::new();
    for line in text.lines() {
        let named = line
            .trim()
            .strip_prefix("<!-- include ")
            .and_then(|rest| rest.strip_suffix(" -->"));
        match named {
            Some(name) => {
                let path = page.parent().unwrap().join(name.trim());
                println!("cargo:rerun-if-changed={}", path.display());
                let mut body = fs::read_to_string(&path).unwrap_or_else(|error| {
                    panic!("{}: cannot include {name}: {error}", page.display())
                });
                if !body.ends_with('\n') {
                    body.push('\n');
                }
                let language = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                writeln!(out, "```{language}\n{}```", body).unwrap();
            }
            None => writeln!(out, "{line}").unwrap(),
        }
    }
    out
}
