//! What Files does with files, through the kernel: make, rename, move,
//! copy, the Trash, and words found in files (ADR 0073, decisions 10 and
//! 11).
//!
//! The `trash` crate finds the Trash by `XDG_DATA_HOME`, which a test may
//! not set in its own process: the tests that touch the Trash run in a
//! process of their own (`the_trash_is_tried_in_a_throwaway_home`), with
//! a throwaway one, and leave the Person's alone anywhere else.

#[cfg(all(unix, not(target_os = "macos")))]
use banda_files::model::Trashcan;
use banda_files::model::{Done, Job, Searched, Step};
use banda_kernel::{Code, CommandId, Participant, Refusal};
use serde_json::{Value, json};
use std::path::Path;
use std::time::Duration;

mod world;
use world::World;

impl World {
    /// A stream's pieces, as the Person hears them, until it ends.
    async fn heard(&self, method: &str, params: Value) -> Result<Vec<Value>, Refusal> {
        let person = Participant::Person(self.owner);
        let mut stream = (self.kernel)
            .stream(person, method, Some(self.project), params)
            .await?;
        let mut pieces = Vec::new();
        loop {
            let piece = tokio::time::timeout(Duration::from_secs(10), stream.recv());
            match piece.await.expect("the stream said nothing within 10 s") {
                Some(piece) => pieces.push(piece),
                None => return Ok(pieces),
            }
        }
    }

    /// A move's or a copy's last piece.
    async fn job(&self, method: &str, params: Value) -> Job {
        let pieces = self.heard(method, params).await.unwrap();
        serde_json::from_value(pieces.last().expect("no piece").clone()).unwrap()
    }

    /// What a move or a copy did, when it did not ask.
    async fn done(&self, method: &str, params: Value) -> Done {
        match self.job(method, params).await {
            Job::Done(done) => done,
            other => panic!("not done: {other:?}"),
        }
    }

    async fn did(&self, method: &str, params: Value) -> Done {
        serde_json::from_value(self.command(method, params).await.unwrap()).unwrap()
    }

    /// `path`, named with `/`, in the Project's folder as Files names it:
    /// joined part by part, so on Windows with `\` between them.
    fn path(&self, path: &str) -> String {
        let whole = (path.split('/')).fold(self.folder.clone(), |at, part| at.join(part));
        whole.to_string_lossy().into_owned()
    }

    fn has(&self, path: &str) -> bool {
        self.folder.join(path).symlink_metadata().is_ok()
    }

    fn text(&self, path: &str) -> String {
        std::fs::read_to_string(self.folder.join(path)).unwrap()
    }

    /// Runs `undo`'s steps, as the window does.
    async fn undo(&self, undo: &[Step]) {
        for step in undo {
            match step {
                Step::Rename { path, name } => {
                    self.did("files.rename", json!({ "path": path, "name": name }))
                        .await;
                }
                Step::Move { paths, dir } => {
                    self.done("files.move", json!({ "paths": paths, "dir": dir }))
                        .await;
                }
                Step::Trash { paths } => {
                    self.did("files.trash", json!({ "paths": paths })).await;
                }
                Step::Restore { items } => {
                    self.did("files.restore", json!({ "items": items })).await;
                }
            }
        }
    }
}

fn refused(result: Result<Value, Refusal>) -> Refusal {
    result.expect_err("it was done")
}

#[tokio::test]
async fn make_makes_a_file_or_a_folder_never_over_one_there() {
    let world = World::new().await;
    world.write("src/main.rs", "");
    let made = world
        .did(
            "files.make",
            json!({ "dir": "src", "name": "new.rs", "kind": "file" }),
        )
        .await;
    assert_eq!(made.paths, vec![world.path("src/new.rs")]);
    assert_eq!(
        made.undo,
        vec![Step::Trash {
            paths: vec![world.path("src/new.rs")]
        }]
    );
    assert_eq!(world.text("src/new.rs"), "");
    world
        .did(
            "files.make",
            json!({ "dir": "", "name": "docs", "kind": "folder" }),
        )
        .await;
    assert!(world.folder.join("docs").is_dir());
    let taken = refused(
        world
            .command(
                "files.make",
                json!({ "dir": "src", "name": "main.rs", "kind": "folder" }),
            )
            .await,
    );
    assert_eq!(taken.code, Code::Conflict, "{taken:?}");
    for bad in ["", "..", "a/b"] {
        let refusal = refused(
            world
                .command(
                    "files.make",
                    json!({ "dir": "src", "name": bad, "kind": "file" }),
                )
                .await,
        );
        assert_eq!(refusal.code, Code::Invalid, "{bad:?}");
    }
}

#[tokio::test]
async fn rename_renames_in_its_folder_and_answers_how_to_name_it_back() {
    let world = World::new().await;
    world.write("a.txt", "a");
    world.write("b.txt", "b");
    let done = world
        .did("files.rename", json!({ "path": "a.txt", "name": "c.txt" }))
        .await;
    assert_eq!(done.paths, vec![world.path("c.txt")]);
    assert!(!world.has("a.txt") && world.text("c.txt") == "a");
    // Never over another.
    let taken = refused(
        world
            .command("files.rename", json!({ "path": "c.txt", "name": "b.txt" }))
            .await,
    );
    assert_eq!(taken.code, Code::Conflict, "{taken:?}");
    assert_eq!(world.text("b.txt"), "b");
    // A name that changes only its case is a name of its own here, and on
    // a disk that does not tell case apart, the same file renamed.
    let case = world
        .did("files.rename", json!({ "path": "c.txt", "name": "C.txt" }))
        .await;
    assert!(world.has("C.txt"));
    world.undo(&case.undo).await;
    world.undo(&done.undo).await;
    assert_eq!(world.text("a.txt"), "a");
    assert!(!world.has("c.txt") && !world.has("C.txt"));
}

#[tokio::test]
async fn a_resend_of_a_change_answers_what_it_did_and_does_nothing_more() {
    let world = World::new().await;
    world.write("a.txt", "a");
    // Each acts on the disk before the kernel keeps its answer: a resend,
    // as after a lost connection, answers from its receipt, not "not
    // there" nor "already there" (ADR 0082, decision 4).
    let read = world.call("files.read", json!({ "path": "a.txt" })).await;
    let base = read.unwrap()["hash"].clone();
    let changes = [
        (
            "files.make",
            json!({ "dir": "", "name": "new.txt", "kind": "file" }),
        ),
        ("files.rename", json!({ "path": "a.txt", "name": "b.txt" })),
        (
            "files.write",
            json!({ "path": "b.txt", "text": "b", "base": base }),
        ),
    ];
    for (method, params) in changes {
        let command = CommandId::new();
        let first = world.command_as(command, method, params.clone()).await;
        assert!(first.is_ok(), "{method}: {first:?}");
        let again = world.command_as(command, method, params).await;
        assert_eq!(again, first, "{method}");
    }
    assert!(!world.has("a.txt") && world.has("new.txt"));
    assert_eq!(world.text("b.txt"), "b");
}

#[cfg(unix)]
#[tokio::test]
async fn a_link_is_renamed_moved_and_copied_as_a_link() {
    let world = World::new().await;
    world.write("src/main.rs", "fn main() {}");
    std::os::unix::fs::symlink(world.folder.join("src"), world.folder.join("code")).unwrap();
    world
        .did("files.rename", json!({ "path": "code", "name": "source" }))
        .await;
    let link = world.folder.join("source");
    assert!(link.is_symlink() && world.folder.join("src/main.rs").is_file());
    std::fs::create_dir(world.folder.join("kept")).unwrap();
    world
        .done("files.copy", json!({ "paths": ["source"], "dir": "kept" }))
        .await;
    let copy = world.folder.join("kept/source");
    assert!(copy.is_symlink());
    assert_eq!(std::fs::read_link(copy).unwrap(), world.folder.join("src"));
}

#[tokio::test]
async fn a_move_goes_to_another_folder_and_is_undone_back_to_its_own() {
    let world = World::new().await;
    world.write("src/a.rs", "a");
    world.write("src/deep/b.rs", "b");
    world.write("lib/keep.rs", "");
    let done = world
        .done(
            "files.move",
            json!({ "paths": ["src/a.rs", "src/deep"], "dir": "lib" }),
        )
        .await;
    assert_eq!(
        done.paths,
        vec![world.path("lib/a.rs"), world.path("lib/deep")]
    );
    assert!(!world.has("src/a.rs") && world.text("lib/deep/b.rs") == "b");
    assert_eq!(
        done.undo,
        vec![Step::Move {
            paths: vec![world.path("lib/a.rs"), world.path("lib/deep")],
            dir: world.path("src"),
        }]
    );
    world.undo(&done.undo).await;
    assert!(world.text("src/a.rs") == "a" && world.has("src/deep/b.rs"));
    assert!(!world.has("lib/a.rs"));
    // Into its own folder it stays, and a folder never goes into itself.
    let stays = world
        .done("files.move", json!({ "paths": ["src/a.rs"], "dir": "src" }))
        .await;
    assert!(stays.undo.is_empty() && world.has("src/a.rs"));
    let itself = refused(
        world
            .first("files.move", json!({ "paths": ["src"], "dir": "src/deep" }))
            .await,
    );
    assert_eq!(itself.code, Code::Invalid, "{itself:?}");
}

#[tokio::test]
async fn a_clash_is_asked_first_then_kept_both_or_skipped_as_answered() {
    let world = World::new().await;
    world.write("in/a.txt", "new a");
    world.write("in/b.txt", "new b");
    world.write("in/c.txt", "c");
    world.write("out/a.txt", "old a");
    world.write("out/b.txt", "old b");
    let paths = json!(["in/a.txt", "in/b.txt", "in/c.txt"]);
    // Asked, it does nothing and says the names taken.
    let Job::Clashes { clashes } = world
        .job("files.copy", json!({ "paths": paths, "dir": "out" }))
        .await
    else {
        panic!("no clash said");
    };
    let names: Vec<&str> = clashes.iter().map(|one| one.name.as_str()).collect();
    assert_eq!(names, ["a.txt", "b.txt"]);
    assert_eq!(clashes[0].path, "in/a.txt");
    assert!(!world.has("out/c.txt"));
    // Each answered: a kept beside, b left; c had no clash.
    let done = world
        .done(
            "files.copy",
            json!({
                "paths": paths,
                "dir": "out",
                "answers": { "in/a.txt": "keep-both", "in/b.txt": "skip" },
            }),
        )
        .await;
    assert_eq!(
        done.paths,
        vec![world.path("out/a 2.txt"), world.path("out/c.txt")]
    );
    assert_eq!(done.skipped, vec!["in/b.txt"]);
    assert_eq!(world.text("out/a 2.txt"), "new a");
    assert_eq!(world.text("out/a.txt"), "old a");
    assert_eq!(world.text("out/b.txt"), "old b");
    // Keep both for all, moved: a third a, and undone it comes back named
    // as it was.
    let moved = world
        .done(
            "files.move",
            json!({ "paths": ["in/a.txt"], "dir": "out", "clash": "keep-both" }),
        )
        .await;
    assert_eq!(moved.paths, vec![world.path("out/a 3.txt")]);
    world.undo(&moved.undo).await;
    assert_eq!(world.text("in/a.txt"), "new a");
    assert!(!world.has("out/a 3.txt") && !world.has("in/a 3.txt"));
}

#[tokio::test]
async fn a_copy_takes_a_folder_whole_and_a_duplicate_goes_beside() {
    let world = World::new().await;
    world.write("src/lib/a.rs", "a");
    world.write("src/lib/deep/b.rs", "b");
    let done = world
        .done("files.copy", json!({ "paths": ["src/lib"], "dir": "" }))
        .await;
    assert_eq!(done.paths, vec![world.path("lib")]);
    assert_eq!(world.text("lib/deep/b.rs"), "b");
    assert_eq!(world.text("src/lib/a.rs"), "a");
    assert_eq!(
        done.undo,
        vec![Step::Trash {
            paths: vec![world.path("lib")]
        }]
    );
    // Into its own folder, a copy is a duplicate: beside, never asked.
    let twice = world
        .done(
            "files.copy",
            json!({ "paths": ["src/lib/a.rs", "src/lib/a.rs"], "dir": "src/lib" }),
        )
        .await;
    assert_eq!(
        twice.paths,
        vec![world.path("src/lib/a 2.rs"), world.path("src/lib/a 3.rs")]
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_copy_keeps_a_files_permissions_and_its_time() {
    use std::os::unix::fs::PermissionsExt;
    let world = World::new().await;
    world.write("run.sh", "#!/bin/sh\n");
    let file = world.folder.join("run.sh");
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o751)).unwrap();
    let was = std::time::SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000);
    std::fs::File::options()
        .write(true)
        .open(&file)
        .unwrap()
        .set_modified(was)
        .unwrap();
    std::fs::create_dir(world.folder.join("bin")).unwrap();
    world
        .done("files.copy", json!({ "paths": ["run.sh"], "dir": "bin" }))
        .await;
    let copy = std::fs::metadata(world.folder.join("bin/run.sh")).unwrap();
    assert_eq!(copy.permissions().mode() & 0o777, 0o751);
    assert_eq!(copy.modified().unwrap(), was);
}

#[tokio::test]
async fn a_long_copy_says_how_far_it_is_and_stops_when_asked() {
    let world = World::new().await;
    std::fs::create_dir_all(world.folder.join("big")).unwrap();
    std::fs::create_dir_all(world.folder.join("out")).unwrap();
    // Enough bytes that a copy is said on its way, and can be stopped.
    let chunk = vec![7u8; 1 << 20];
    for n in 0..48 {
        std::fs::write(world.folder.join(format!("big/{n:02}.bin")), &chunk).unwrap();
    }
    let person = Participant::Person(world.owner);
    let mut stream = (world.kernel)
        .stream(
            person,
            "files.copy",
            Some(world.project),
            json!({ "paths": ["big"], "dir": "out", "job": "the copy" }),
        )
        .await
        .unwrap();
    let mut said = false;
    let done = loop {
        let piece = tokio::time::timeout(Duration::from_secs(20), stream.recv())
            .await
            .unwrap()
            .expect("it ended without saying so");
        match serde_json::from_value(piece).unwrap() {
            Job::Progress { done, of, .. } => {
                assert_eq!(of, 48 << 20);
                assert!(done <= of);
                if !said {
                    said = true;
                    world
                        .command("files.cancel", json!({ "job": "the copy" }))
                        .await
                        .unwrap();
                }
            }
            Job::Done(done) => break done,
            other => panic!("{other:?}"),
        }
    };
    // Stopped, it left nothing half done.
    assert!(said, "no progress was said");
    assert!(done.stopped, "{done:?}");
    assert!(done.paths.is_empty() && done.undo.is_empty(), "{done:?}");
    assert!(!world.has("out/big"));
    // Done whole, the same copy says it reached its end.
    let done = world
        .done("files.copy", json!({ "paths": ["big"], "dir": "out" }))
        .await;
    assert!(!done.stopped);
    assert_eq!(
        std::fs::read_dir(world.folder.join("out/big"))
            .unwrap()
            .count(),
        48
    );
}

#[tokio::test]
async fn a_move_across_disks_copies_then_removes_the_first() {
    // Where the machine has a second disk in memory beside its temporary
    // one, as most Linux machines do.
    let Ok(other) = tempfile::tempdir_in("/dev/shm") else {
        return;
    };
    let world = World::new().await;
    world.write("probe", "");
    let probe = other.path().join("probe");
    if std::fs::rename(world.folder.join("probe"), &probe).is_ok() {
        // One disk: nothing to try here.
        return;
    }
    world.write("src/a/b.txt", "b");
    let dir = other.path().to_string_lossy().into_owned();
    let done = world
        .done("files.move", json!({ "paths": ["src/a"], "dir": dir }))
        .await;
    assert!(done.failed.is_none(), "{done:?}");
    assert!(!world.has("src/a"));
    assert_eq!(
        std::fs::read_to_string(other.path().join("a/b.txt")).unwrap(),
        "b"
    );
    world.undo(&done.undo).await;
    assert_eq!(world.text("src/a/b.txt"), "b");
}

#[tokio::test]
async fn an_agent_moves_nothing_out_of_its_project_nor_into_it_from_outside() {
    let world = World::new().await;
    world.write("a.txt", "a");
    let outside = world.outside().to_string_lossy().into_owned();
    let agent = |method: &'static str, params: Value| {
        let world = &world;
        async move {
            let mut stream = world.stream_as_agent(method, params).await?;
            Ok::<_, Refusal>(stream.recv().await)
        }
    };
    for (method, params) in [
        ("files.move", json!({ "paths": ["a.txt"], "dir": outside })),
        ("files.copy", json!({ "paths": ["a.txt"], "dir": outside })),
        (
            "files.copy",
            json!({ "paths": [format!("{outside}/secret.txt")], "dir": "" }),
        ),
    ] {
        let refusal = agent(method, params.clone()).await.expect_err("it went");
        assert_eq!(refusal.code, Code::Forbidden, "{method} {params}");
    }
    for (method, params) in [
        (
            "files.make",
            json!({ "dir": outside, "name": "x", "kind": "file" }),
        ),
        (
            "files.rename",
            json!({ "path": format!("{outside}/secret.txt"), "name": "x" }),
        ),
        (
            "files.trash",
            json!({ "paths": [format!("{outside}/secret.txt")] }),
        ),
    ] {
        let refusal = refused(world.command_as_agent(method, params).await);
        assert_eq!(refusal.code, Code::Forbidden, "{method}");
    }
    assert!(Path::new(&outside).join("secret.txt").exists());
    // Inside, it may.
    world
        .command_as_agent("files.rename", json!({ "path": "a.txt", "name": "b.txt" }))
        .await
        .unwrap();
    assert!(world.has("b.txt"));
}

#[tokio::test]
async fn nothing_in_git_nor_in_bandas_settings_is_made_renamed_moved_or_trashed() {
    let world = World::new().await;
    world.write(".git/config", "[core]\n");
    world.write("a.txt", "a");
    let config = world.config();
    std::fs::create_dir_all(&config).unwrap();
    std::fs::write(config.join("files.toml"), "").unwrap();
    let settings = config.join("files.toml").to_string_lossy().into_owned();
    let settings_dir = config.to_string_lossy().into_owned();
    let top = world.root.path().to_string_lossy().into_owned();
    for (method, params) in [
        (
            "files.make",
            json!({ "dir": ".git", "name": "x", "kind": "file" }),
        ),
        (
            "files.make",
            json!({ "dir": settings_dir, "name": "x.toml", "kind": "file" }),
        ),
        (
            "files.rename",
            json!({ "path": ".git/config", "name": "x" }),
        ),
        ("files.rename", json!({ "path": ".git", "name": "git" })),
        ("files.rename", json!({ "path": settings, "name": "x" })),
        // What holds the settings stays where it is.
        ("files.rename", json!({ "path": top, "name": "x" })),
        ("files.trash", json!({ "paths": [".git"] })),
        ("files.trash", json!({ "paths": [settings] })),
    ] {
        let refusal = refused(world.command(method, params.clone()).await);
        assert_eq!(refusal.code, Code::Forbidden, "{method} {params}");
    }
    for (method, params) in [
        ("files.move", json!({ "paths": ["a.txt"], "dir": ".git" })),
        (
            "files.copy",
            json!({ "paths": ["a.txt"], "dir": settings_dir }),
        ),
        ("files.move", json!({ "paths": [".git/config"], "dir": "" })),
    ] {
        let refusal = refused(world.first(method, params.clone()).await);
        assert_eq!(refusal.code, Code::Forbidden, "{method} {params}");
    }
    // What is read from there may be copied out.
    world
        .done("files.copy", json!({ "paths": [".git/config"], "dir": "" }))
        .await;
    assert_eq!(world.text("config"), "[core]\n");
}

#[tokio::test]
async fn search_finds_words_whole_or_as_a_pattern_in_any_case_or_its_own() {
    let world = World::new().await;
    world.write("src/a.rs", "let Needle = 1;\nlet haystack = needles;\n");
    world.write("src/b.rs", "nothing here\n");
    world.write("notes.md", "a needle, then NEEDLE\n");
    let found = |params: Value| {
        let world = &world;
        async move {
            let pieces = world.heard("files.search", params).await.unwrap();
            let mut lines: Vec<String> = Vec::new();
            for piece in pieces {
                if let Searched::File {
                    path, lines: found, ..
                } = serde_json::from_value(piece).unwrap()
                {
                    lines.extend(found.iter().map(|one| format!("{path}:{}", one.line)));
                }
            }
            lines.sort();
            lines
        }
    };
    assert_eq!(
        found(json!({ "query": "needle" })).await,
        ["notes.md:1", "src/a.rs:1", "src/a.rs:2"]
    );
    assert_eq!(
        found(json!({ "query": "needle", "case": true })).await,
        ["notes.md:1", "src/a.rs:2"]
    );
    assert_eq!(
        found(json!({ "query": "needle", "word": true })).await,
        ["notes.md:1", "src/a.rs:1"]
    );
    assert_eq!(
        found(json!({ "query": "Needle|haystack", "regex": true, "case": true })).await,
        ["src/a.rs:1", "src/a.rs:2"]
    );
    // Without regex, the pattern's signs are only letters.
    assert!(
        found(json!({ "query": "Needle|haystack" }))
            .await
            .is_empty()
    );
    let bad = refused(
        world
            .first("files.search", json!({ "query": "(", "regex": true }))
            .await,
    );
    assert_eq!(bad.code, Code::Invalid);
    // Where each match is in its line, as JavaScript counts.
    let pieces = world
        .heard("files.search", json!({ "query": "NEEDLE", "case": true }))
        .await
        .unwrap();
    let Searched::File { lines, .. } = serde_json::from_value(pieces[0].clone()).unwrap() else {
        panic!("no file");
    };
    assert_eq!(lines[0].text, "a needle, then NEEDLE");
    assert_eq!(lines[0].ranges, vec![(15, 21)]);
}

#[tokio::test]
async fn search_leaves_out_what_git_ignores_and_binary_files() {
    let world = World::new().await;
    world.write(".gitignore", "built/\n");
    world.write("built/out.js", "needle\n");
    world.write("src/a.rs", "needle\n");
    world.write(".git/HEAD", "needle\n");
    std::fs::write(world.folder.join("data.bin"), b"needle\0\x01\x02").unwrap();
    let pieces = world
        .heard("files.search", json!({ "query": "needle" }))
        .await
        .unwrap();
    let pieces: Vec<Searched> = pieces
        .into_iter()
        .map(|piece| serde_json::from_value(piece).unwrap())
        .collect();
    let paths: Vec<&str> = pieces
        .iter()
        .filter_map(|piece| match piece {
            Searched::File { path, .. } => Some(path.as_str()),
            Searched::Done { .. } => None,
        })
        .collect();
    assert_eq!(paths, ["src/a.rs"]);
    assert_eq!(
        pieces.last(),
        Some(&Searched::Done {
            files: 1,
            lines: 1,
            cut: false
        })
    );
}

#[tokio::test]
async fn search_says_at_most_100_lines_a_file_and_the_most_asked_in_all() {
    let world = World::new().await;
    world.write("many.txt", &"needle\n".repeat(150));
    for n in 0..5 {
        world.write(&format!("more/{n}.txt"), "needle\n");
    }
    let pieces = world
        .heard("files.search", json!({ "query": "needle", "dir": "" }))
        .await
        .unwrap();
    let many = pieces
        .iter()
        .map(|piece| serde_json::from_value::<Searched>(piece.clone()).unwrap())
        .find_map(|piece| match piece {
            Searched::File { path, lines, more } if path == "many.txt" => Some((lines.len(), more)),
            _ => None,
        });
    assert_eq!(many, Some((100, true)));
    let pieces = world
        .heard(
            "files.search",
            json!({ "query": "needle", "dir": "more", "limit": 3 }),
        )
        .await
        .unwrap();
    let last: Searched = serde_json::from_value(pieces.last().unwrap().clone()).unwrap();
    assert_eq!(
        last,
        Searched::Done {
            files: 3,
            lines: 3,
            cut: true
        }
    );
    // An Agent looks only in its Project.
    let outside = world.outside().to_string_lossy().into_owned();
    let refusal = world
        .stream_as_agent("files.search", json!({ "query": "secret", "dir": outside }))
        .await
        .expect_err("it looked outside");
    assert_eq!(refusal.code, Code::Forbidden);
}

/// The tests whose names start `trash_` run here, in a process of their
/// own whose Trash is a throwaway folder: freedesktop's, which
/// `XDG_DATA_HOME` moves. macOS's is Finder's, which nothing moves.
#[cfg(all(unix, not(target_os = "macos")))]
#[test]
fn the_trash_is_tried_in_a_throwaway_home() {
    if std::env::var_os(TRASH_HOME).is_some() {
        return;
    }
    let home = tempfile::tempdir().unwrap();
    let ran = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["trash_", "--include-ignored", "--test-threads=1"])
        .env("XDG_DATA_HOME", home.path())
        .env(TRASH_HOME, "1")
        .output()
        .unwrap();
    let said = String::from_utf8_lossy(&ran.stdout);
    assert!(
        ran.status.success(),
        "{said}\n{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    for test in [
        "trash_sends_to_the_trash_and_puts_back_as_undone",
        "trash_deletes_for_good_only_there_and_an_agent_sees_its_own",
        "trash_takes_what_a_replace_replaced_and_undone_it_comes_back",
        "trash_takes_what_an_agents_replace_replaced_though_its_move_is_kept_to_its_project",
    ] {
        assert!(said.contains(&format!("test {test} ... ok")), "{said}");
    }
}

/// What says a process's Trash is a throwaway one.
#[cfg(all(unix, not(target_os = "macos")))]
const TRASH_HOME: &str = "BANDA_FILES_TEST_TRASH";

/// Whether this process's Trash is a throwaway one; else a `trash_` test
/// does nothing, as the Person's Trash is not for tests.
#[cfg(all(unix, not(target_os = "macos")))]
fn throwaway() -> bool {
    std::env::var_os(TRASH_HOME).is_some()
}

#[cfg(all(unix, not(target_os = "macos")))]
#[tokio::test]
#[ignore = "run by the_trash_is_tried_in_a_throwaway_home"]
async fn trash_sends_to_the_trash_and_puts_back_as_undone() {
    if !throwaway() {
        return;
    }
    let world = World::new().await;
    world.write("src/a.txt", "a");
    world.write("src/deep/b.txt", "b");
    let done = world
        .did("files.trash", json!({ "paths": ["src/a.txt", "src/deep"] }))
        .await;
    assert!(!world.has("src/a.txt") && !world.has("src/deep"));
    let [Step::Restore { items }] = done.undo.as_slice() else {
        panic!("{:?}", done.undo);
    };
    assert_eq!(items.len(), 2);
    // The Trash lists them, the latest first, with where they came from.
    let can: Trashcan = world.ask("files.trashed", json!({})).await;
    let listed = can.items.unwrap();
    let mut names: Vec<&str> = listed.iter().map(|one| one.name.as_str()).collect();
    names.sort();
    assert_eq!(names, ["a.txt", "deep"]);
    let deep = listed.iter().find(|one| one.name == "deep").unwrap();
    assert!(deep.folder && deep.from == world.path("src"));
    assert!(deep.when > 0);
    let a = listed.iter().find(|one| one.name == "a.txt").unwrap();
    assert_eq!(a.size, Some(1));
    world.undo(&done.undo).await;
    assert_eq!(world.text("src/a.txt"), "a");
    assert_eq!(world.text("src/deep/b.txt"), "b");
    let can: Trashcan = world.ask("files.trashed", json!({})).await;
    assert!(can.items.unwrap().is_empty());
    // A name there again is not put back over.
    let done = world
        .did("files.trash", json!({ "paths": ["src/a.txt"] }))
        .await;
    world.write("src/a.txt", "again");
    let Step::Restore { items } = &done.undo[0] else {
        panic!();
    };
    let refusal = refused(
        world
            .command("files.restore", json!({ "items": items }))
            .await,
    );
    assert_eq!(refusal.code, Code::Conflict);
    assert_eq!(world.text("src/a.txt"), "again");
}

#[cfg(all(unix, not(target_os = "macos")))]
#[tokio::test]
#[ignore = "run by the_trash_is_tried_in_a_throwaway_home"]
async fn trash_deletes_for_good_only_there_and_an_agent_sees_its_own() {
    if !throwaway() {
        return;
    }
    let world = World::new().await;
    world.write("a.txt", "a");
    world.write("b.txt", "b");
    let outside = world.outside();
    world
        .did("files.trash", json!({ "paths": ["a.txt", "b.txt"] }))
        .await;
    world
        .did(
            "files.trash",
            json!({ "paths": [outside.join("secret.txt")] }),
        )
        .await;
    let can: Trashcan = world.ask("files.trashed", json!({})).await;
    assert_eq!(can.items.as_ref().unwrap().len(), 3);
    // An Agent sees, puts back and deletes only what came from its
    // Project.
    let theirs: Trashcan = serde_json::from_value(
        world
            .call_as_agent("files.trashed", json!({}))
            .await
            .unwrap(),
    )
    .unwrap();
    let theirs = theirs.items.unwrap();
    assert_eq!(theirs.len(), 2);
    let secret = (can.items.unwrap())
        .into_iter()
        .find(|one| one.name == "secret.txt")
        .unwrap();
    let refusal = refused(
        world
            .command_as_agent("files.delete", json!({ "items": [secret.id] }))
            .await,
    );
    assert_eq!(refusal.code, Code::Conflict, "{refusal:?}");
    // Deleted for good, an item is gone from the Trash.
    let a = theirs.iter().find(|one| one.name == "a.txt").unwrap();
    let gone = world
        .command("files.delete", json!({ "items": [a.id] }))
        .await
        .unwrap();
    assert_eq!(gone, json!(1));
    let can: Trashcan = world.ask("files.trashed", json!({})).await;
    let mut names: Vec<String> = can.items.unwrap().into_iter().map(|one| one.name).collect();
    names.sort();
    assert_eq!(names, ["b.txt", "secret.txt"]);
    // An Agent's Empty Trash empties what is its own.
    world
        .command_as_agent("files.empty", json!({}))
        .await
        .unwrap();
    let can: Trashcan = world.ask("files.trashed", json!({})).await;
    let names: Vec<String> = can.items.unwrap().into_iter().map(|one| one.name).collect();
    assert_eq!(names, ["secret.txt"]);
    assert_eq!(
        world.command("files.empty", json!({})).await.unwrap(),
        json!(1)
    );
}

#[cfg(all(unix, not(target_os = "macos")))]
#[tokio::test]
#[ignore = "run by the_trash_is_tried_in_a_throwaway_home"]
async fn trash_takes_what_a_replace_replaced_and_undone_it_comes_back() {
    if !throwaway() {
        return;
    }
    let world = World::new().await;
    world.write("in/a.txt", "new");
    world.write("out/a.txt", "old");
    let done = world
        .done(
            "files.move",
            json!({ "paths": ["in/a.txt"], "dir": "out", "clash": "replace" }),
        )
        .await;
    assert_eq!(world.text("out/a.txt"), "new");
    assert!(!world.has("in/a.txt"));
    assert!(
        matches!(done.undo.last(), Some(Step::Restore { .. })),
        "{done:?}"
    );
    world.undo(&done.undo).await;
    assert_eq!(world.text("in/a.txt"), "new");
    assert_eq!(world.text("out/a.txt"), "old");
}

#[cfg(all(unix, not(target_os = "macos")))]
#[tokio::test]
#[ignore = "run by the_trash_is_tried_in_a_throwaway_home"]
async fn trash_takes_what_an_agents_replace_replaced_though_its_move_is_kept_to_its_project() {
    if !throwaway() {
        return;
    }
    let world = World::new().await;
    world.write("in/a.txt", "new");
    world.write("out/a.txt", "old");
    let params = json!({ "paths": ["in/a.txt"], "dir": "out", "clash": "replace" });
    let mut stream = world.stream_as_agent("files.move", params).await.unwrap();
    let mut last = None;
    while let Some(piece) = tokio::time::timeout(Duration::from_secs(10), stream.recv())
        .await
        .expect("the move said nothing within 10 s")
    {
        last = Some(piece);
    }
    let Job::Done(done) = serde_json::from_value(last.expect("no piece")).unwrap() else {
        panic!("not done");
    };
    assert_eq!(done.failed, None);
    assert_eq!(world.text("out/a.txt"), "new");
    assert!(
        matches!(done.undo.last(), Some(Step::Restore { .. })),
        "{done:?}"
    );
    world.undo(&done.undo).await;
    assert_eq!(world.text("out/a.txt"), "old");
}
