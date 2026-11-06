//! `banda look` as a script or the window runs it: JSON on stdout, and
//! `check` speaking as compilers do.

mod common;

use common::{banda, wait_for};
use std::io::{BufRead, BufReader};
use std::process::Stdio;
use std::time::Duration;

#[test]
fn look_prints_the_resolved_look_as_json() {
    let config = tempfile::tempdir().unwrap();
    std::fs::write(config.path().join("look.toml"), "radius = 6\n").unwrap();
    let out = banda(config.path(), &["look"]);
    assert!(out.status.success());
    let look: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(look["mode"], "system");
    assert_eq!(look["vars"]["--radius"], "6px");
    assert_eq!(look["vars"]["--tile-radius"], "8.4px");
    assert!(look["schemes"]["light"]["--background"].is_string());
    assert!(look["schemes"]["dark"]["--background"].is_string());
}

#[test]
fn look_check_names_the_line_and_exits_one() {
    let config = tempfile::tempdir().unwrap();
    let file = config.path().join("look.toml");
    std::fs::write(&file, "[gaps]\ninner = 4\nouter = \"wide\"\n").unwrap();
    let out = banda(config.path(), &["look", "check"]);
    assert_eq!(out.status.code(), Some(1));
    let said = String::from_utf8(out.stderr).unwrap();
    assert!(
        said.starts_with(&format!("{}:3:9: ", file.display())),
        "{said}"
    );

    std::fs::write(&file, "[gaps]\nouter = 8\n").unwrap();
    let out = banda(config.path(), &["look", "check", file.to_str().unwrap()]);
    assert!(out.status.success());
    assert!(out.stderr.is_empty() && out.stdout.is_empty());
}

#[test]
fn look_themes_lists_bandas_own_one_per_line() {
    let config = tempfile::tempdir().unwrap();
    let out = banda(config.path(), &["look", "themes"]);
    assert!(out.status.success());
    let names: Vec<String> = String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap()["name"].to_string())
        .collect();
    assert!(names.starts_with(&["\"banda-light\"".into(), "\"banda-dark\"".into()]));
}

#[test]
fn look_follow_with_a_parent_stops_once_its_stdin_closes() {
    let config = tempfile::tempdir().unwrap();
    let mut look = common::on(config.path())
        .args(["look", "--follow", "--with-parent"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut said = BufReader::new(look.stdout.take().unwrap());
    let mut first = String::new();
    said.read_line(&mut first).unwrap();
    assert!(first.starts_with('{'), "{first}");

    // The window goes: the look goes with it, though nothing changed and
    // it has nothing to print.
    drop(look.stdin.take());
    let Some(status) = wait_for(Duration::from_secs(5), || look.try_wait().unwrap()) else {
        look.kill().unwrap();
        panic!("the look did not stop within five seconds of its parent");
    };
    assert!(status.success(), "{status:?}");
}
