//! Files' depth, through the kernel (ADR 0073, step F6): a file's small
//! picture, from freedesktop's cache or made from the file and kept, and
//! what a path is at length, a picture's EXIF and the last commit too.

use banda_files::model::{Counted, Info, Kind, Thumb};
use banda_files::thumb::{self, MOST};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use exif::{Field, In, Rational, Tag, Value};
use image::{DynamicImage, ImageFormat, RgbImage};
use serde_json::json;
use std::io::Cursor;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, UNIX_EPOCH};

mod world;
use world::World;

/// A picture `width` by `height`, of one colour, in `format`.
fn picture(width: u32, height: u32, format: ImageFormat) -> Vec<u8> {
    let image = DynamicImage::ImageRgb8(RgbImage::from_pixel(width, height, [200, 80, 40].into()));
    let mut bytes = Cursor::new(Vec::new());
    image.write_to(&mut bytes, format).unwrap();
    bytes.into_inner()
}

/// A PNG `width` by `height` that says `said` in its text, as
/// freedesktop's thumbnailers write theirs.
fn png_saying(width: u32, height: u32, said: &[(&str, String)]) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, width, height);
    encoder.set_color(png::ColorType::Rgb);
    for (key, text) in said {
        encoder
            .add_text_chunk((*key).to_owned(), text.clone())
            .unwrap();
    }
    let mut writer = encoder.write_header().unwrap();
    writer
        .write_image_data(&vec![9; (width * height * 3) as usize])
        .unwrap();
    writer.finish().unwrap();
    bytes
}

/// The file's time in whole seconds, as `Thumb::MTime` says it.
fn seconds(path: &Path) -> u64 {
    let modified = std::fs::metadata(path).unwrap().modified().unwrap();
    modified.duration_since(UNIX_EPOCH).unwrap().as_secs()
}

async fn thumb(world: &World, path: &str, size: u32) -> Option<Thumb> {
    world
        .ask("files.thumb", json!({ "path": path, "size": size }))
        .await
}

/// What a thumb's bytes are: a PNG's width and height.
fn drawn(thumb: &Thumb) -> (u32, u32) {
    let bytes = BASE64.decode(&thumb.data).unwrap();
    let read = image::load_from_memory_with_format(&bytes, ImageFormat::Png).unwrap();
    (read.width(), read.height())
}

#[tokio::test]
async fn a_picture_is_made_small_and_kept_in_bandas_cache_and_freedesktops() {
    let world = World::new().await;
    std::fs::write(
        world.folder.join("wide.jpg"),
        picture(300, 200, ImageFormat::Jpeg),
    )
    .unwrap();
    let made = thumb(&world, "wide.jpg", 100).await.unwrap();
    assert_eq!(made.mime, "image/png");
    assert_eq!((made.width, made.height), (128, 85));
    assert_eq!(drawn(&made), (128, 85));

    // Kept: once in Banda's cache, and in freedesktop's at its size, which
    // says the file it shows.
    let path = world.folder.join("wide.jpg");
    let kept: Vec<_> = std::fs::read_dir(world.cache()).unwrap().collect();
    assert_eq!(kept.len(), 1);
    let shared = world
        .shared()
        .join("normal")
        .join(thumb::shared_name(&path));
    let reader = png::Decoder::new(Cursor::new(std::fs::read(&shared).unwrap()))
        .read_info()
        .unwrap();
    let said = |key: &str| {
        (reader.info().uncompressed_latin1_text.iter())
            .find(|chunk| chunk.keyword == key)
            .map(|chunk| chunk.text.clone())
    };
    assert_eq!(said("Thumb::URI"), Some(thumb::uri_of(&path)));
    assert_eq!(said("Thumb::MTime"), Some(seconds(&path).to_string()));

    // Asked again, the same.
    assert_eq!(thumb(&world, "wide.jpg", 128).await, Some(made));
    // A size of its own is made apart.
    let small = thumb(&world, "wide.jpg", 64).await.unwrap();
    assert_eq!((small.width, small.height), (64, 43));
}

#[tokio::test]
async fn freedesktops_picture_is_taken_while_it_names_the_files_time() {
    let world = World::new().await;
    let path = world.folder.join("photo.png");
    std::fs::write(&path, picture(300, 200, ImageFormat::Png)).unwrap();
    let shared = world.shared().join("normal");
    std::fs::create_dir_all(&shared).unwrap();
    let theirs = |time: u64| {
        png_saying(
            7,
            5,
            &[
                ("Thumb::URI", thumb::uri_of(&path)),
                ("Thumb::MTime", time.to_string()),
            ],
        )
    };

    // Its time is the file's: it is the picture.
    std::fs::write(
        shared.join(thumb::shared_name(&path)),
        theirs(seconds(&path)),
    )
    .unwrap();
    let found = thumb(&world, "photo.png", 128).await.unwrap();
    assert_eq!((found.width, found.height), (7, 5));
    // Nothing was made, nor kept.
    assert!(!world.cache().exists());

    // The file changed since: it is made again from the file, and put
    // there in its place.
    std::fs::write(
        shared.join(thumb::shared_name(&path)),
        theirs(seconds(&path) - 60),
    )
    .unwrap();
    let made = thumb(&world, "photo.png", 128).await.unwrap();
    assert_eq!((made.width, made.height), (128, 85));
    let now = std::fs::read(shared.join(thumb::shared_name(&path))).unwrap();
    assert_eq!(BASE64.decode(&made.data).unwrap(), now);
}

#[tokio::test]
async fn a_file_past_the_cap_or_not_a_picture_has_none() {
    let world = World::new().await;
    // Past the cap, though a PNG: never read.
    let big = std::fs::File::create(world.folder.join("big.png")).unwrap();
    big.set_len(MOST + 1).unwrap();
    assert_eq!(thumb(&world, "big.png", 128).await, None);
    // Not a picture, or not what its name says.
    world.write("notes.txt", "words");
    assert_eq!(thumb(&world, "notes.txt", 128).await, None);
    world.write("fake.png", "not a picture");
    assert_eq!(thumb(&world, "fake.png", 128).await, None);
    // A folder.
    world.write("src/a.rs", "");
    assert_eq!(thumb(&world, "src", 128).await, None);
    // An Agent reaches only the Project's.
    let outside = world.outside();
    std::fs::write(outside.join("p.png"), picture(4, 4, ImageFormat::Png)).unwrap();
    let asked = json!({ "path": outside.join("p.png"), "size": 64 });
    assert!(world.call_as_agent("files.thumb", asked).await.is_err());
}

/// A JPEG `width` by `height` whose EXIF says `fields`.
fn jpeg_with(width: u32, height: u32, fields: &[Field]) -> Vec<u8> {
    let jpeg = picture(width, height, ImageFormat::Jpeg);
    let mut writer = exif::experimental::Writer::new();
    for field in fields {
        writer.push_field(field);
    }
    let mut tiff = Cursor::new(Vec::new());
    writer.write(&mut tiff, false).unwrap();
    let tiff = tiff.into_inner();
    let length = u16::try_from(2 + 6 + tiff.len()).unwrap();
    // Its APP1, right after the JPEG's start.
    let mut bytes = jpeg[..2].to_vec();
    bytes.extend_from_slice(&[0xFF, 0xE1]);
    bytes.extend_from_slice(&length.to_be_bytes());
    bytes.extend_from_slice(b"Exif\0\0");
    bytes.extend_from_slice(&tiff);
    bytes.extend_from_slice(&jpeg[2..]);
    bytes
}

fn field(tag: Tag, value: Value) -> Field {
    Field {
        tag,
        ifd_num: In::PRIMARY,
        value,
    }
}

fn ascii(text: &str) -> Value {
    Value::Ascii(vec![text.as_bytes().to_vec()])
}

fn rationals(parts: &[(u32, u32)]) -> Value {
    Value::Rational(parts.iter().map(|&part| Rational::from(part)).collect())
}

#[tokio::test]
async fn a_pictures_info_says_its_size_turned_and_what_its_camera_wrote() {
    let world = World::new().await;
    let fields = [
        field(Tag::Make, ascii("Fujifilm")),
        field(Tag::Model, ascii("X-T4")),
        field(Tag::Orientation, Value::Short(vec![6])),
        field(Tag::LensModel, ascii("XF35mmF1.4 R")),
        field(Tag::DateTimeOriginal, ascii("2026:05:04 18:30:12")),
        field(Tag::ExposureTime, rationals(&[(1, 250)])),
        field(Tag::FNumber, rationals(&[(28, 10)])),
        field(Tag::PhotographicSensitivity, Value::Short(vec![400])),
        field(Tag::FocalLength, rationals(&[(35, 1)])),
        field(Tag::GPSLatitudeRef, ascii("N")),
        field(
            Tag::GPSLatitude,
            rationals(&[(48, 1), (51, 1), (3013, 100)]),
        ),
        field(Tag::GPSLongitudeRef, ascii("E")),
        field(
            Tag::GPSLongitude,
            rationals(&[(2, 1), (17, 1), (4013, 100)]),
        ),
    ];
    std::fs::write(world.folder.join("shot.jpg"), jpeg_with(40, 30, &fields)).unwrap();
    let info: Info = world.ask("files.info", json!({ "path": "shot.jpg" })).await;
    assert_eq!(info.kind, Kind::File);
    assert_eq!(info.mime.as_deref(), Some("image/jpeg"));
    assert!(info.size.is_some_and(|size| size > 0));
    assert!(info.modified.is_some());
    // Turned a quarter by its EXIF: it shows 30 wide.
    let shown = info.picture.unwrap();
    assert_eq!((shown.width, shown.height), (30, 40));
    let exif = info.exif.unwrap();
    assert_eq!(exif.camera.as_deref(), Some("Fujifilm X-T4"));
    assert_eq!(exif.lens.as_deref(), Some("XF35mmF1.4 R"));
    assert_eq!(exif.taken.as_deref(), Some("2026-05-04 18:30:12"));
    assert_eq!(
        exif.exposure.as_deref(),
        Some("1/250 s · f/2.8 · ISO 400 · 35 mm")
    );
    assert_eq!(exif.place.as_deref(), Some("48.85837° N, 2.29448° E"));
    // A picture with no EXIF says none.
    std::fs::write(
        world.folder.join("plain.png"),
        picture(3, 2, ImageFormat::Png),
    )
    .unwrap();
    let info: Info = world
        .ask("files.info", json!({ "path": "plain.png" }))
        .await;
    assert_eq!(info.picture.map(|p| (p.width, p.height)), Some((3, 2)));
    assert_eq!(info.exif, None);
}

fn git(folder: &Path, args: &[&str]) {
    let done = Command::new("git")
        .arg("-C")
        .arg(folder)
        .args([
            "-c",
            "user.name=Ada Lovelace",
            "-c",
            "user.email=ada@example.com",
        ])
        .args(args)
        .env("GIT_AUTHOR_DATE", "2026-05-04T18:30:12Z")
        .env("GIT_COMMITTER_DATE", "2026-05-04T18:30:12Z")
        .output()
        .unwrap();
    assert!(
        done.status.success(),
        "{}",
        String::from_utf8_lossy(&done.stderr)
    );
}

#[tokio::test]
async fn a_files_info_names_the_last_commit_that_changed_it() {
    let world = World::new().await;
    world.write("src/a.rs", "fn a() {}\n");
    world.write("b.md", "# B\n");
    git(&world.folder, &["init", "-q"]);
    git(&world.folder, &["add", "src/a.rs"]);
    git(&world.folder, &["commit", "-q", "-m", "Add a"]);
    git(&world.folder, &["add", "b.md"]);
    git(&world.folder, &["commit", "-q", "-m", "Add b"]);

    let info: Info = world.ask("files.info", json!({ "path": "src/a.rs" })).await;
    let commit = info.commit.unwrap();
    assert_eq!(commit.subject, "Add a");
    assert_eq!(commit.author, "Ada Lovelace");
    assert_eq!(commit.when, 1_777_919_412_000);
    assert_eq!(commit.hash.len(), 40);
    // A folder's is the last that changed what it holds.
    let info: Info = world.ask("files.info", json!({ "path": "src" })).await;
    assert_eq!(info.kind, Kind::Folder);
    assert_eq!(info.items, Some(1));
    assert_eq!(info.commit.unwrap().subject, "Add a");
    // A file git does not know has none.
    world.write("new.txt", "");
    let info: Info = world.ask("files.info", json!({ "path": "new.txt" })).await;
    assert_eq!(info.commit, None);
}

#[cfg(unix)]
#[tokio::test]
async fn a_links_info_says_where_it_leads_and_whether_it_leads_anywhere() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let world = World::new().await;
    world.write("real.txt", "twelve bytes");
    std::fs::set_permissions(
        world.folder.join("real.txt"),
        std::fs::Permissions::from_mode(0o640),
    )
    .unwrap();
    symlink("real.txt", world.folder.join("link.txt")).unwrap();
    symlink("gone.txt", world.folder.join("broken")).unwrap();

    let info: Info = world.ask("files.info", json!({ "path": "link.txt" })).await;
    assert_eq!(info.kind, Kind::Link);
    assert_eq!(info.link.as_deref(), Some("real.txt"));
    assert!(!info.dangling);
    assert_eq!(info.path, world.folder.join("link.txt").to_string_lossy());
    // What it leads to: its size and permissions.
    assert_eq!(info.size, Some(12));
    assert_eq!(info.mode, Some(0o640));
    assert!(info.owner.is_some_and(|owner| !owner.is_empty()));

    let info: Info = world.ask("files.info", json!({ "path": "broken" })).await;
    assert_eq!(info.kind, Kind::Link);
    assert_eq!(info.link.as_deref(), Some("gone.txt"));
    assert!(info.dangling);
    assert_eq!(info.size, None);
}

#[tokio::test]
async fn a_folders_size_is_counted_as_asked() {
    let world = World::new().await;
    world.write("deep/a.txt", "12345");
    world.write("deep/more/b.txt", "1234567890");
    let mut heard = world
        .kernel
        .stream(
            banda_kernel::Participant::Person(world.owner),
            "files.size",
            Some(world.project),
            json!({ "path": "deep" }),
        )
        .await
        .unwrap();
    let mut last = None;
    while let Ok(Some(piece)) = tokio::time::timeout(Duration::from_secs(5), heard.recv()).await {
        let counted: Counted = serde_json::from_value(piece).unwrap();
        last = Some(counted);
        if counted.done {
            break;
        }
    }
    assert_eq!(
        last,
        Some(Counted {
            bytes: 15,
            files: 2,
            done: true
        })
    );
    let refused = world
        .first("files.size", json!({ "path": "deep/a.txt" }))
        .await;
    assert!(refused.is_err());
}
