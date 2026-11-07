//! The files module through the kernel, as a Pane and an Agent use it.

use banda_files::model::{
    Archive, Found, Kind, Listing, Locked, Opened, Packing, Places, Sheet, Stat, Text, Watched,
    Written,
};
use banda_kernel::{AgentId, Caller, Code, Participant};
use serde_json::json;
use std::io::Write;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

mod world;
use world::World;

fn git(folder: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(folder)
        .args(args)
        .output()
        .is_ok_and(|out| out.status.success())
}

fn names(listing: &Listing) -> Vec<&str> {
    listing.entries.iter().map(|e| e.name.as_str()).collect()
}

#[tokio::test]
async fn a_folder_lists_folders_first_then_by_name_as_a_person_reads_it() {
    let world = World::new().await;
    for path in ["b10.txt", "B2.txt", "a.txt", ".env", "zeta/x", "Alpha/y"] {
        world.write(path, "x");
    }
    let listing: Listing = world.ask("files.list", json!({ "dir": "" })).await;
    assert_eq!(listing.dir, world.folder.to_string_lossy());
    assert!(listing.inside);
    assert_eq!(
        names(&listing),
        ["Alpha", "zeta", ".env", "a.txt", "B2.txt", "b10.txt"]
    );
    let env = &listing.entries[2];
    assert!(env.hidden && env.kind == Kind::File && env.size == Some(1));
    assert!(env.modified.is_some());
    assert!(!listing.entries[3].hidden);
    let alpha = &listing.entries[0];
    assert_eq!((alpha.kind, alpha.size), (Kind::Folder, None));
}

#[cfg(unix)]
#[tokio::test]
async fn a_link_says_whether_it_leads_to_a_folder() {
    let world = World::new().await;
    world.write("src/main.rs", "");
    std::os::unix::fs::symlink(world.folder.join("src"), world.folder.join("code")).unwrap();
    let listing: Listing = world.ask("files.list", json!({ "dir": "" })).await;
    assert_eq!(names(&listing), ["code", "src"]);
    let code = &listing.entries[0];
    assert!(code.kind == Kind::Link && code.to_folder);
}

#[tokio::test]
async fn what_git_ignores_is_marked_not_left_out() {
    let world = World::new().await;
    if !git(&world.folder, &["init", "-q"]) {
        return;
    }
    world.write(".gitignore", "built/\n*.log\n");
    world.write("built/out.js", "");
    world.write("debug.log", "");
    world.write("src/kept.rs", "");
    let listing: Listing = world.ask("files.list", json!({ "dir": "" })).await;
    let ignored: Vec<&str> = (listing.entries.iter())
        .filter(|e| e.ignored)
        .map(|e| e.name.as_str())
        .collect();
    assert_eq!(ignored, ["built", "debug.log"]);
    assert_eq!(
        names(&listing),
        [".git", "built", "src", ".gitignore", "debug.log"]
    );
    // Inside .git, nothing is marked.
    let inside: Listing = world.ask("files.list", json!({ "dir": ".git" })).await;
    assert!(inside.entries.iter().all(|e| !e.ignored));
}

#[tokio::test]
async fn the_person_lists_any_folder_and_an_agent_only_the_projects() {
    let world = World::new().await;
    let outside = world.outside();
    let dir = outside.to_string_lossy();
    let listing: Listing = world.ask("files.list", json!({ "dir": dir })).await;
    assert_eq!(names(&listing), ["secret.txt"]);
    assert!(!listing.inside);

    for (method, params) in [
        ("files.list", json!({ "dir": dir })),
        ("files.list", json!({ "dir": "../outside" })),
        ("files.read", json!({ "path": outside.join("secret.txt") })),
        (
            "files.stat",
            json!({ "paths": [outside.join("secret.txt")] }),
        ),
        ("files.find", json!({ "dir": dir, "query": "" })),
        ("files.watch", json!({ "dirs": [dir] })),
    ] {
        let refused = match method {
            "files.watch" => {
                let agent = Caller {
                    participant: Participant::Agent(AgentId::new()),
                    only: Some(world.project),
                };
                world.kernel.stream(agent, method, None, params).await.err()
            }
            _ => world.call_as_agent(method, params).await.err(),
        };
        let refused = refused.unwrap_or_else(|| panic!("{method} reached outside"));
        assert_eq!(refused.code, Code::Forbidden, "{method}");
    }
    world.write("notes.md", "# hi");
    let listing = world.call_as_agent("files.list", json!({})).await.unwrap();
    assert_eq!(listing["entries"][0]["name"], "notes.md");
}

#[cfg(unix)]
#[tokio::test]
async fn an_agent_follows_no_link_out_of_the_folder() {
    let world = World::new().await;
    let outside = world.outside();
    std::os::unix::fs::symlink(&outside, world.folder.join("out")).unwrap();
    let refused = (world.call_as_agent("files.read", json!({ "path": "out/secret.txt" })))
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Forbidden);
    let text: Text = (world.ask("files.read", json!({ "path": "out/secret.txt" }))).await;
    assert_eq!(text.text.as_deref(), Some("secret"));
}

#[tokio::test]
#[cfg_attr(
    windows,
    ignore = "Windows refuses a folder read as a file by another error: ADR 0090's step 3"
)]
async fn a_text_is_read_and_cut_on_a_character() {
    let world = World::new().await;
    world.write("a.txt", "héllo");
    let text: Text = world
        .ask("files.read", json!({ "path": "a.txt", "upto": 2 }))
        .await;
    assert_eq!(text.text.as_deref(), Some("h"));
    assert!(text.truncated && !text.binary && text.hash.is_none());
    assert_eq!(text.bytes, 6);
    let whole: Text = world.ask("files.read", json!({ "path": "a.txt" })).await;
    assert_eq!(whole.text.as_deref(), Some("héllo"));
    assert_eq!(whole.hash.unwrap().len(), 64);

    let refused = world
        .call("files.read", json!({ "path": "gone.txt" }))
        .await;
    assert_eq!(refused.unwrap_err().code, Code::NotFound);
    let refused = world.call("files.read", json!({ "path": "" })).await;
    assert_eq!(refused.unwrap_err().code, Code::Invalid);
}

#[tokio::test]
async fn a_stat_says_what_each_path_is_or_that_it_is_gone() {
    let world = World::new().await;
    world.write("docs/notes.md", "# hi");
    let stats: Vec<Option<Stat>> = (world.ask(
        "files.stat",
        json!({ "paths": ["docs", "docs/notes.md", "gone"] }),
    ))
    .await;
    let docs = stats[0].as_ref().unwrap();
    assert_eq!(docs.kind, Kind::Folder);
    let notes = stats[1].as_ref().unwrap();
    assert_eq!(notes.mime.as_deref(), Some("text/markdown"));
    assert_eq!(notes.size, Some(4));
    assert_eq!(stats[2], None);
}

#[tokio::test]
async fn find_ranks_a_name_above_a_folder_and_leaves_out_what_is_ignored() {
    let world = World::new().await;
    for path in [
        "main/notes.txt",
        "src/main.rs",
        "src/domain.rs",
        "built/main.js",
        ".gitignore",
    ] {
        world.write(path, "");
    }
    world.write(".gitignore", "built/\n");
    let found: Found = world.ask("files.find", json!({ "query": "main" })).await;
    assert_eq!(
        found.paths,
        ["src/main.rs", "src/domain.rs", "main/notes.txt"]
    );
    assert!(!found.cut);
    let found: Found = (world.ask(
        "files.find",
        json!({ "dir": "src", "query": "rs", "limit": 1 }),
    ))
    .await;
    assert_eq!(found.paths.len(), 1);
    assert_eq!(found.dir, world.folder.join("src").to_string_lossy());
}

#[tokio::test]
async fn watch_says_which_folder_changed() {
    let world = World::new().await;
    world.write("src/main.rs", "");
    let person = Participant::Person(world.owner);
    let mut stream = (world.kernel)
        .stream(
            person,
            "files.watch",
            Some(world.project),
            json!({ "dirs": ["", "src"] }),
        )
        .await
        .unwrap();
    let mut next = async || -> Watched {
        let piece = tokio::time::timeout(Duration::from_secs(2), stream.recv())
            .await
            .expect("nothing heard within 2 s")
            .expect("the stream ended");
        serde_json::from_value(piece).unwrap()
    };
    assert_eq!(
        next().await,
        Watched::Watching {
            dirs: vec![String::new(), "src".to_owned()]
        }
    );
    world.write("src/new.rs", "");
    assert_eq!(
        next().await,
        Watched::Changed {
            dirs: vec!["src".to_owned()]
        }
    );
}

#[tokio::test]
async fn places_names_home_and_only_the_folders_that_are_there() {
    let world = World::new().await;
    let places: Places = world.ask("files.places", json!({})).await;
    let home = dirs::home_dir().unwrap();
    assert_eq!(places.home, home.to_string_lossy());
    for place in [&places.desktop, &places.downloads].into_iter().flatten() {
        assert!(std::path::Path::new(place).is_dir(), "{place}");
    }
}

#[tokio::test]
async fn what_the_person_opened_comes_back_latest_first_and_gone_files_stay_out() {
    let world = World::new().await;
    for path in ["a.md", "src/b.rs", "c.txt"] {
        world.write(path, "");
    }
    for path in ["a.md", "src/b.rs", "a.md", "c.txt"] {
        world
            .command("files.opened", json!({ "path": path }))
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    // A command needs its ID, as every command does.
    let refused = world.call("files.opened", json!({ "path": "a.md" })).await;
    assert_eq!(refused.unwrap_err().code, Code::Invalid);

    std::fs::remove_file(world.folder.join("src/b.rs")).unwrap();
    let recent: Vec<Opened> = world.ask("files.recent", json!({})).await;
    let paths: Vec<&str> = recent.iter().map(|file| file.path.as_str()).collect();
    let whole = |path: &str| world.folder.join(path).to_string_lossy().into_owned();
    assert_eq!(paths, [whole("c.txt"), whole("a.md")]);
    assert_eq!((recent[0].count, recent[1].count), (1, 2));
    assert!(recent[0].last >= recent[1].last);
    let one: Vec<Opened> = world.ask("files.recent", json!({ "limit": 1 })).await;
    assert_eq!(one.len(), 1);
}

#[tokio::test]
async fn find_raises_a_file_the_person_opened_among_matches_alike() {
    let world = World::new().await;
    for path in ["a/main.rs", "b/main.rs", "main/notes.txt"] {
        world.write(path, "");
    }
    let found: Found = world.ask("files.find", json!({ "query": "main" })).await;
    assert_eq!(found.paths[..2], ["a/main.rs", "b/main.rs"]);
    for path in ["b/main.rs", "main/notes.txt", "main/notes.txt"] {
        world
            .command("files.opened", json!({ "path": path }))
            .await
            .unwrap();
    }
    let found: Found = world.ask("files.find", json!({ "query": "main" })).await;
    assert_eq!(
        found.paths,
        ["b/main.rs", "a/main.rs", "main/notes.txt"],
        "a match in a name stays above one in a folder"
    );
}

/// A zip of `names`, each holding its name, stored as it is.
fn zip_of(path: &Path, names: &[&str]) {
    let mut zip = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    let stored = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .last_modified_time(zip::DateTime::from_date_and_time(2026, 11, 6, 12, 30, 0).unwrap());
    for name in names {
        if let Some(folder) = name.strip_suffix('/') {
            zip.add_directory(folder, stored).unwrap();
        } else {
            zip.start_file(*name, stored).unwrap();
            zip.write_all(name.as_bytes()).unwrap();
        }
    }
    zip.finish().unwrap();
}

/// A tar's header for `name`, written as it is, `..` and all, as the
/// tar crate's own paths refuse it.
fn tar_header(name: &str, size: u64, folder: bool) -> tar::Header {
    let mut header = tar::Header::new_ustar();
    header.as_old_mut().name[..name.len()].copy_from_slice(name.as_bytes());
    header.set_size(size);
    header.set_mode(0o644);
    header.set_mtime(1_700_000_000);
    header.set_entry_type(if folder {
        tar::EntryType::Directory
    } else {
        tar::EntryType::Regular
    });
    header.set_cksum();
    header
}

#[tokio::test]
async fn a_zip_lists_its_names_sizes_and_times_and_unpacks_nothing() {
    let world = World::new().await;
    zip_of(
        &world.folder.join("site.zip"),
        &["docs/", "docs/a.md", "../x", "/etc/passwd"],
    );
    let archive: Archive = world
        .ask("files.archive", json!({ "path": "site.zip" }))
        .await;
    assert_eq!(archive.packing, Packing::Zip);
    assert!(!archive.truncated);
    let paths: Vec<&str> = archive.entries.iter().map(|e| e.path.as_str()).collect();
    assert_eq!(paths, ["docs/", "docs/a.md", "../x", "/etc/passwd"]);
    let docs = &archive.entries[0];
    assert!(docs.folder && docs.size.is_none());
    let a = &archive.entries[1];
    assert!(!a.folder);
    assert_eq!((a.size, a.packed), (Some(9), Some(9)));
    // 2026-11-06 12:30 as the zip writes it, read as UTC.
    assert_eq!(a.modified, Some(1_793_968_200_000));
    // A name that climbs out is only text: nothing is written beside it.
    assert!(!world.folder.join("x").exists());
    assert!(!world.folder.parent().unwrap().join("x").exists());
}

#[tokio::test]
async fn a_gzipped_tar_lists_its_names_and_a_name_that_climbs_out_is_only_shown() {
    let world = World::new().await;
    let gz = flate2::write::GzEncoder::new(
        std::fs::File::create(world.folder.join("build.tar.gz")).unwrap(),
        flate2::Compression::fast(),
    );
    let mut tar = tar::Builder::new(gz);
    for (name, body) in [
        ("bin/", None),
        ("bin/run", Some("#!/bin/sh\n")),
        ("../x", Some("out")),
    ] {
        let size = body.map_or(0, str::len) as u64;
        let header = tar_header(name, size, body.is_none());
        tar.append(&header, body.unwrap_or("").as_bytes()).unwrap();
    }
    tar.into_inner().unwrap().finish().unwrap();

    let archive: Archive = world
        .ask("files.archive", json!({ "path": "build.tar.gz" }))
        .await;
    assert_eq!(archive.packing, Packing::TarGz);
    let paths: Vec<&str> = archive.entries.iter().map(|e| e.path.as_str()).collect();
    assert_eq!(paths, ["bin/", "bin/run", "../x"]);
    assert!(archive.entries[0].folder);
    assert_eq!(archive.entries[1].size, Some(10));
    assert_eq!(archive.entries[1].modified, Some(1_700_000_000_000));
    assert!(!world.folder.parent().unwrap().join("x").exists());

    // A plain tar, and a gzip of one file that is no tar.
    let mut plain = tar::Builder::new(std::fs::File::create(world.folder.join("a.tar")).unwrap());
    plain
        .append(&tar_header("a.txt", 1, false), &b"a"[..])
        .unwrap();
    plain.into_inner().unwrap();
    let archive: Archive = world.ask("files.archive", json!({ "path": "a.tar" })).await;
    assert_eq!(archive.packing, Packing::Tar);
    assert_eq!(archive.entries[0].path, "a.txt");
    let mut one = flate2::write::GzEncoder::new(
        std::fs::File::create(world.folder.join("notes.txt.gz")).unwrap(),
        flate2::Compression::fast(),
    );
    one.write_all(b"just some notes").unwrap();
    one.finish().unwrap();
    let archive: Archive = world
        .ask("files.archive", json!({ "path": "notes.txt.gz" }))
        .await;
    assert_eq!(archive.packing, Packing::Gz);
    assert_eq!(archive.entries.len(), 1);
    assert_eq!(archive.entries[0].path, "notes.txt");
    assert_eq!(archive.entries[0].size, Some(15));
}

#[tokio::test]
async fn an_archive_of_many_names_is_cut_at_ten_thousand_and_a_text_is_refused() {
    let world = World::new().await;
    let names: Vec<String> = (0..10_001).map(|n| format!("f{n}.txt")).collect();
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    zip_of(&world.folder.join("many.zip"), &names);
    let archive: Archive = world
        .ask("files.archive", json!({ "path": "many.zip" }))
        .await;
    assert_eq!(archive.entries.len(), 10_000);
    assert!(archive.truncated);
    assert_eq!(archive.entries[9_999].path, "f9999.txt");

    world.write("notes.txt", "not an archive");
    let refused = world
        .call("files.archive", json!({ "path": "notes.txt" }))
        .await;
    assert_eq!(refused.unwrap_err().code, Code::Invalid);
    let refused = world
        .call("files.archive", json!({ "path": "gone.zip" }))
        .await;
    assert_eq!(refused.unwrap_err().code, Code::NotFound);
}

#[tokio::test]
async fn an_agent_lists_no_archive_outside_its_projects_folder() {
    let world = World::new().await;
    let outside = world.outside();
    zip_of(&outside.join("secret.zip"), &["key.txt"]);
    let path = outside.join("secret.zip").to_string_lossy().into_owned();
    let refused = world
        .call_as_agent("files.archive", json!({ "path": path }))
        .await;
    assert_eq!(refused.unwrap_err().code, Code::Forbidden);
    let archive: Archive = world.ask("files.archive", json!({ "path": path })).await;
    assert_eq!(archive.entries[0].path, "key.txt");
}

/// A workbook of two sheets, as Excel writes the least of one: its cells
/// inline, a number, a date and a word.
fn xlsx_of(path: &Path) {
    let sheet = |rows: &str| {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{rows}</sheetData></worksheet>"#
        )
    };
    let word =
        |at: &str, text: &str| format!(r#"<c r="{at}" t="inlineStr"><is><t>{text}</t></is></c>"#);
    let parts = [
        (
            "[Content_Types].xml",
            r#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#.to_owned(),
        ),
        (
            "_rels/.rels",
            r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#.to_owned(),
        ),
        (
            "xl/workbook.xml",
            r#"<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>"#.to_owned(),
        ),
        (
            "xl/_rels/workbook.xml.rels",
            r#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>"#.to_owned(),
        ),
        (
            "xl/worksheets/sheet1.xml",
            sheet(&format!(
                r#"<row r="1">{}{}</row><row r="2">{}<c r="B2"><v>42.5</v></c></row>"#,
                word("A1", "Fruit"),
                word("B1", "Price"),
                word("A2", "Pear"),
            )),
        ),
        (
            "xl/worksheets/sheet2.xml",
            sheet(&format!(r#"<row r="1">{}</row>"#, word("A1", "Hello"))),
        ),
    ];
    let mut zip = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    let stored =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for (name, text) in parts {
        zip.start_file(name, stored).unwrap();
        zip.write_all(text.as_bytes()).unwrap();
    }
    zip.finish().unwrap();
}

#[tokio::test]
async fn a_workbook_reads_its_first_sheet_and_another_by_name() {
    let world = World::new().await;
    xlsx_of(&world.folder.join("book.xlsx"));
    let sheet: Sheet = world
        .ask("files.sheet", json!({ "path": "book.xlsx" }))
        .await;
    assert_eq!(sheet.sheets, ["Sales", "Notes"]);
    assert_eq!(sheet.sheet, "Sales");
    assert_eq!(sheet.rows, [["Fruit", "Price"], ["Pear", "42.5"]]);
    assert!(!sheet.truncated);
    let notes: Sheet = world
        .ask(
            "files.sheet",
            json!({ "path": "book.xlsx", "sheet": "Notes" }),
        )
        .await;
    assert_eq!(notes.rows, [["Hello"]]);
    let refused = world
        .call(
            "files.sheet",
            json!({ "path": "book.xlsx", "sheet": "Gone" }),
        )
        .await;
    assert_eq!(refused.unwrap_err().code, Code::Invalid);
}

/// A 7z of a folder and two files, as `7z a` packs them, its header
/// packed too: 196 bytes, kept here as no crate here writes one.
const SEVEN_Z: [u8; 196] = [
    0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x04, 0xff, 0x5b, 0xa5, 0x37, 0x83, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x21, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x27, 0xbf, 0xd8, 0xb8,
    0x01, 0x00, 0x15, 0x6d, 0x6f, 0x72, 0x65, 0x20, 0x77, 0x6f, 0x72, 0x64, 0x73, 0x20, 0x68, 0x65,
    0x72, 0x65, 0x0a, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x0a, 0x00, 0x00, 0x00, 0x81, 0x33, 0x07, 0xae,
    0x0f, 0xcf, 0xa4, 0x2e, 0xb8, 0x0f, 0xeb, 0xea, 0x9c, 0xbf, 0x36, 0x3d, 0xfe, 0x73, 0x25, 0x81,
    0xf2, 0x01, 0xb7, 0x48, 0x4e, 0xd0, 0xab, 0x4f, 0x02, 0x12, 0x12, 0x35, 0xb0, 0x82, 0xc7, 0x17,
    0x56, 0xc8, 0x2a, 0x75, 0xd6, 0xbb, 0x2e, 0x66, 0x49, 0x1d, 0xaa, 0x0a, 0x86, 0xb8, 0xca, 0x64,
    0xd6, 0xea, 0xad, 0xa4, 0xa8, 0x76, 0x30, 0x2b, 0x92, 0x74, 0x5e, 0x86, 0x55, 0x95, 0xdd, 0x28,
    0xcb, 0x3b, 0x8e, 0x47, 0xef, 0x1f, 0xd9, 0xa4, 0xba, 0xf1, 0xce, 0x36, 0xeb, 0xc3, 0x05, 0x79,
    0x1e, 0xf3, 0x82, 0x63, 0xf3, 0x41, 0x01, 0x79, 0x37, 0x99, 0xff, 0x3f, 0x8b, 0x8c, 0xc1, 0x5e,
    0x4d, 0x00, 0x00, 0x17, 0x06, 0x1a, 0x01, 0x09, 0x69, 0x00, 0x07, 0x0b, 0x01, 0x00, 0x01, 0x23,
    0x03, 0x01, 0x01, 0x05, 0x5d, 0x00, 0x10, 0x00, 0x00, 0x0c, 0x80, 0x8a, 0x0a, 0x01, 0x35, 0x15,
    0xdf, 0x31, 0x00, 0x00,
];

#[tokio::test]
async fn a_7z_lists_its_names_from_its_packed_header() {
    let world = World::new().await;
    std::fs::write(world.folder.join("t.7z"), SEVEN_Z).unwrap();
    let archive: Archive = world.ask("files.archive", json!({ "path": "t.7z" })).await;
    assert_eq!(archive.packing, Packing::SevenZ);
    let mut paths: Vec<&str> = archive.entries.iter().map(|e| e.path.as_str()).collect();
    paths.sort_unstable();
    assert_eq!(paths, ["b.txt", "docs", "docs/a.txt"]);
    let docs = archive.entries.iter().find(|e| e.path == "docs").unwrap();
    assert!(docs.folder);
    let b = archive.entries.iter().find(|e| e.path == "b.txt").unwrap();
    assert_eq!(b.size, Some(16));
    assert_eq!(b.modified, Some(1_793_968_200_000));
}

/// What `files.write` answers for the Person, or its refusal.
async fn write(world: &World, path: &str, text: &str, base: Option<&str>) -> Written {
    let params = json!({ "path": path, "text": text, "base": base });
    serde_json::from_value(world.command("files.write", params).await.unwrap()).unwrap()
}

async fn hash_of(world: &World, path: &str) -> String {
    let text: Text = world.ask("files.read", json!({ "path": path })).await;
    text.hash.unwrap()
}

fn on_disk(world: &World, path: &str) -> String {
    std::fs::read_to_string(world.folder.join(path)).unwrap()
}

#[tokio::test]
async fn a_write_saves_over_the_hash_it_was_read_at_and_answers_the_next() {
    let world = World::new().await;
    world.write("src/a.ts", "one\n");
    let base = hash_of(&world, "src/a.ts").await;
    let Written::Written { hash } = write(&world, "src/a.ts", "one\ntwo\n", Some(&base)).await
    else {
        panic!("not written");
    };
    assert_eq!(on_disk(&world, "src/a.ts"), "one\ntwo\n");
    assert_eq!(hash, hash_of(&world, "src/a.ts").await);
    // Sent again, as a command that lost its answer is: the file holds it
    // already, which is no conflict.
    assert_eq!(
        write(&world, "src/a.ts", "one\ntwo\n", Some(&base)).await,
        Written::Written { hash: hash.clone() }
    );
    // Nothing is left beside it.
    let names: Vec<_> = std::fs::read_dir(world.folder.join("src"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(names, ["a.ts"]);
    // A command needs its ID.
    let refused = (world.call(
        "files.write",
        json!({ "path": "src/a.ts", "text": "", "base": hash }),
    ))
    .await
    .unwrap_err();
    assert_eq!(refused.code, Code::Invalid);
}

#[tokio::test]
async fn a_file_that_moved_since_its_base_is_not_written_and_says_who_moved_it() {
    let world = World::new().await;
    world.write("notes.md", "mine\n");
    let base = hash_of(&world, "notes.md").await;
    // Another app writes it.
    world.write("notes.md", "theirs\n");
    let theirs = hash_of(&world, "notes.md").await;
    assert_eq!(
        write(&world, "notes.md", "mine, edited\n", Some(&base)).await,
        Written::Moved {
            hash: Some(theirs.clone()),
            by: None
        }
    );
    assert_eq!(on_disk(&world, "notes.md"), "theirs\n");

    // An Agent writes it through Files: a write over the old hash names it.
    let params = json!({ "path": "notes.md", "text": "the agent's\n", "base": theirs });
    let wrote = world.command_as_agent("files.write", params).await.unwrap();
    let Ok(Written::Written { hash: agents }) = serde_json::from_value(wrote) else {
        panic!("not written");
    };
    let Written::Moved { hash, by } = write(&world, "notes.md", "mine\n", Some(&theirs)).await
    else {
        panic!("written over the Agent's");
    };
    assert_eq!(hash, Some(agents.clone()));
    assert!(matches!(by, Some(Participant::Agent(_))), "{by:?}");

    // Keep mine: written over what is there now.
    let Written::Written { .. } = write(&world, "notes.md", "mine\n", Some(&agents)).await else {
        panic!("not written");
    };
    assert_eq!(on_disk(&world, "notes.md"), "mine\n");

    // Gone: its hash is none.
    std::fs::remove_file(world.folder.join("notes.md")).unwrap();
    assert_eq!(
        write(&world, "notes.md", "again\n", Some(&agents)).await,
        Written::Moved {
            hash: None,
            by: None
        }
    );
}

#[tokio::test]
#[cfg_attr(
    windows,
    ignore = "Windows refuses a folder written as a file by another error: ADR 0090's step 3"
)]
async fn a_new_file_is_written_only_where_none_is() {
    let world = World::new().await;
    std::fs::create_dir_all(world.folder.join("docs")).unwrap();
    let Written::Written { hash } = write(&world, "docs/new.md", "# New\n", None).await else {
        panic!("not written");
    };
    assert_eq!(on_disk(&world, "docs/new.md"), "# New\n");
    // One there now is not written over without its hash.
    assert_eq!(
        write(&world, "docs/new.md", "# Other\n", None).await,
        Written::Moved {
            hash: Some(hash),
            by: Some(Participant::Person(world.owner))
        }
    );
    assert_eq!(on_disk(&world, "docs/new.md"), "# New\n");
    // Its folder is not made.
    let params = json!({ "path": "nowhere/new.md", "text": "", "base": null });
    let refused = world.command("files.write", params).await.unwrap_err();
    assert_eq!(refused.code, Code::NotFound);
    // A folder is no file.
    let params = json!({ "path": "docs", "text": "", "base": null });
    let refused = world.command("files.write", params).await.unwrap_err();
    assert_eq!(refused.code, Code::Invalid);
}

#[cfg(unix)]
#[tokio::test]
async fn a_write_keeps_the_files_permissions_and_a_new_one_gets_the_usual() {
    use std::os::unix::fs::PermissionsExt;
    let world = World::new().await;
    let mode = |path: &str| {
        let meta = std::fs::metadata(world.folder.join(path)).unwrap();
        meta.permissions().mode() & 0o7777
    };
    world.write("run.sh", "echo one\n");
    let script = world.folder.join("run.sh");
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o750)).unwrap();
    let base = hash_of(&world, "run.sh").await;
    write(&world, "run.sh", "echo two\n", Some(&base)).await;
    assert_eq!(on_disk(&world, "run.sh"), "echo two\n");
    assert_eq!(mode("run.sh"), 0o750);

    // As a file any program makes there, past the temporary file's 0600.
    world.write("usual.txt", "");
    write(&world, "new.txt", "new\n", None).await;
    assert_eq!(mode("new.txt"), mode("usual.txt"));
}

#[cfg(unix)]
#[tokio::test]
async fn a_link_is_written_at_its_target_and_stays_a_link() {
    let world = World::new().await;
    world.write("real.md", "real\n");
    std::os::unix::fs::symlink(world.folder.join("real.md"), world.folder.join("link.md")).unwrap();
    let base = hash_of(&world, "link.md").await;
    write(&world, "link.md", "through the link\n", Some(&base)).await;
    assert_eq!(on_disk(&world, "real.md"), "through the link\n");
    let link = std::fs::symlink_metadata(world.folder.join("link.md")).unwrap();
    assert!(link.is_symlink());

    // A link to nothing is not written through, nor made a file.
    std::os::unix::fs::symlink(
        world.folder.join("gone.md"),
        world.folder.join("dangling.md"),
    )
    .unwrap();
    let params = json!({ "path": "dangling.md", "text": "x", "base": null });
    let refused = world.command("files.write", params).await.unwrap_err();
    assert_eq!(refused.code, Code::Forbidden);
    assert!(!world.folder.join("gone.md").exists());

    // An Agent's link out of the Project is the guard's to refuse.
    let outside = world.outside();
    std::os::unix::fs::symlink(outside.join("secret.txt"), world.folder.join("leak.txt")).unwrap();
    let params = json!({ "path": "leak.txt", "text": "x", "base": null });
    let refused = world
        .command_as_agent("files.write", params)
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Forbidden);
    let params = json!({ "path": outside.join("new.txt"), "text": "x", "base": null });
    let refused = world
        .command_as_agent("files.write", params)
        .await
        .unwrap_err();
    assert_eq!(refused.code, Code::Forbidden);
    assert_eq!(
        std::fs::read_to_string(outside.join("secret.txt")).unwrap(),
        "secret"
    );
}

#[tokio::test]
async fn nothing_is_written_in_git_nor_in_bandas_settings_and_a_read_says_so() {
    let world = World::new().await;
    world.write(".git/config", "[core]\n");
    std::fs::create_dir_all(world.config()).unwrap();
    let look = world.config().join("look.toml");
    std::fs::write(&look, "theme = \"dark\"\n").unwrap();
    let look = look.to_string_lossy().into_owned();
    for (path, locked) in [
        (".git/config", Locked::Git),
        (look.as_str(), Locked::Settings),
    ] {
        let text: Text = world.ask("files.read", json!({ "path": path })).await;
        assert_eq!(text.locked, Some(locked), "{path}");
        let params = json!({ "path": path, "text": "x", "base": text.hash });
        let refused = world.command("files.write", params).await.unwrap_err();
        assert_eq!(refused.code, Code::Forbidden, "{path}");
    }
    assert_eq!(on_disk(&world, ".git/config"), "[core]\n");
    assert_eq!(
        std::fs::read_to_string(&look).unwrap(),
        "theme = \"dark\"\n"
    );
    // A file anywhere else may be.
    world.write("a.txt", "");
    let text: Text = world.ask("files.read", json!({ "path": "a.txt" })).await;
    assert_eq!(text.locked, None);
}

#[cfg(unix)]
#[tokio::test]
async fn a_file_this_user_may_not_write_reads_as_locked() {
    use std::os::unix::fs::PermissionsExt;
    let world = World::new().await;
    world.write("frozen.txt", "cold\n");
    let frozen = world.folder.join("frozen.txt");
    std::fs::set_permissions(&frozen, std::fs::Permissions::from_mode(0o444)).unwrap();
    // Root writes what it likes.
    if std::fs::OpenOptions::new()
        .write(true)
        .open(&frozen)
        .is_ok()
    {
        return;
    }
    let text: Text = world
        .ask("files.read", json!({ "path": "frozen.txt" }))
        .await;
    assert_eq!(text.locked, Some(Locked::Denied));
    let params = json!({ "path": "frozen.txt", "text": "warm\n", "base": text.hash });
    let refused = world.command("files.write", params).await.unwrap_err();
    assert_eq!(refused.code, Code::Forbidden);
    assert_eq!(on_disk(&world, "frozen.txt"), "cold\n");
}
