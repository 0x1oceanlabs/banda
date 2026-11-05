//! `banda menu [route]` asks Banda's window to open its menu (ADR 0017).
#![cfg(unix)]

mod common;

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::process::Output;

fn menu(state: &std::path::Path, args: &[&str]) -> Output {
    common::banda_in(state, state, &[&["menu"], args].concat())
}

#[test]
fn with_no_window_open_it_says_so() {
    let state = tempfile::tempdir().unwrap();
    let out = menu(state.path(), &["actions"]);
    assert_eq!(out.status.code(), Some(2));
    assert_eq!(
        String::from_utf8(out.stderr).unwrap(),
        "banda: Banda's window is not open.\n"
    );
}

#[test]
fn it_tells_the_window_the_route_in_one_line_and_hears_ok() {
    let state = tempfile::tempdir().unwrap();
    let door = UnixListener::bind(state.path().join("window.sock")).unwrap();
    let window = std::thread::spawn(move || {
        let mut heard = Vec::new();
        for answer in ["ok", "no window"] {
            let (mut socket, _) = door.accept().unwrap();
            let mut line = String::new();
            BufReader::new(&socket).read_line(&mut line).unwrap();
            heard.push(line);
            writeln!(socket, "{answer}").unwrap();
        }
        heard
    });

    let out = menu(state.path(), &["project.My Work"]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let out = menu(state.path(), &[]);
    assert_eq!(out.status.code(), Some(2));
    assert_eq!(
        String::from_utf8(out.stderr).unwrap(),
        "banda: Banda's window said: no window\n"
    );

    assert_eq!(
        window.join().unwrap(),
        ["{\"menu\":\"project.My Work\"}\n", "{\"menu\":\"\"}\n"]
    );
}
