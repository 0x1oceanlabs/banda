//! `banda export`: what an App keeps in a Project, as lines anyone can
//! read (ADR 0085, decision 10). It asks the engine's apps module for the
//! export, a stream of pieces, and prints each line as one JSON line,
//! `{"file", "line"}`, and last `{"done"}` with each file's count; or,
//! with `--to`, writes the export's files in a folder:
//!
//! ```text
//! <to>/<app>/app.json          its id, version and ledger, each table's CREATE
//! <to>/<app>/events.ndjson     its events, in the log's order
//! <to>/<app>/<table>.ndjson    one row a line
//! ```
//!
//! An export the engine did not say `done` of was cut short: it fails,
//! and says so. An App's files are not in it yet.

use crate::Failure;
use crate::client::Client;
use crate::places::Places;
use banda_kernel::ProjectId;
use banda_kernel::api::EngineFrame;
use serde_json::{Value, json};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;

/// Prints the export of `app` in `project`, or writes it under `to`.
pub async fn export(
    places: &Places,
    app: String,
    project: ProjectId,
    to: Option<PathBuf>,
) -> Result<(), Failure> {
    let mut client = Client::connect(places).await?;
    let params = json!({ "project": project, "app": app });
    let stream = client.stream_with("apps.export", params).await?;
    let mut out = match to {
        Some(to) => Out::folder(to.join(&app))?,
        None => Out::Printed(BufWriter::new(std::io::stdout())),
    };
    let mut done = None;
    loop {
        match client.heard().await? {
            EngineFrame::Piece { stream: of, data } if of == stream => match data.get("done") {
                Some(counts) => done = Some(counts.clone()),
                // A reader that went away ends it.
                None if out.write(&data).is_err() => return Ok(()),
                None => {}
            },
            EngineFrame::Result {
                id,
                error: Some(refusal),
                ..
            } if id == stream => return Err(Failure::Refused(refusal)),
            EngineFrame::Ended { stream: of } if of == stream => break,
            _ => {}
        }
    }
    let Some(done) = done else {
        let words =
            "The export was cut short: the engine's log says why. What was written is not whole.";
        return Err(Failure::Broken(words.to_owned()));
    };
    out.end(done).map_err(Failure::broken)
}

/// Where an export goes: printed, or the files of its folder.
enum Out {
    Printed(BufWriter<std::io::Stdout>),
    Files {
        folder: PathBuf,
        /// The file its pieces go in now: each file's come together.
        open: Option<(String, BufWriter<File>)>,
    },
}

impl Out {
    fn folder(folder: PathBuf) -> Result<Out, Failure> {
        std::fs::create_dir_all(&folder).map_err(Failure::broken)?;
        Ok(Out::Files { folder, open: None })
    }

    /// Writes one piece's lines: each printed with its file, or in the
    /// file the piece names, made as it is first named, `app.json` whole.
    fn write(&mut self, piece: &Value) -> std::io::Result<()> {
        let name = piece["file"].as_str().unwrap_or_default();
        let lines = piece["lines"].as_array().into_iter().flatten();
        match self {
            Out::Printed(out) => {
                for line in lines {
                    writeln!(out, "{}", json!({ "file": name, "line": line }))?;
                }
            }
            Out::Files { folder, open } => {
                if open.as_ref().is_none_or(|(of, _)| of != name) {
                    // A file of the export's folder, by a plain name.
                    let plain = banda_kernel::plain_name(name).is_some_and(|plain| plain == name);
                    if !plain {
                        let named = format!("the export names a file {name:?}");
                        return Err(std::io::Error::other(named));
                    }
                    if let Some((_, mut before)) = open.take() {
                        before.flush()?;
                    }
                    let made = BufWriter::new(File::create(folder.join(name))?);
                    *open = Some((name.to_owned(), made));
                }
                let (_, file) = open.as_mut().expect("just opened");
                for line in lines {
                    match name {
                        "app.json" => writeln!(file, "{}", serde_json::to_string_pretty(line)?)?,
                        _ => writeln!(file, "{line}")?,
                    }
                }
            }
        }
        Ok(())
    }

    /// Ends it, whole: what it holds, by file, as the engine counted it.
    fn end(self, done: Value) -> std::io::Result<()> {
        match self {
            Out::Printed(mut out) => {
                writeln!(out, "{}", json!({ "done": done }))?;
                out.flush()
            }
            Out::Files { folder, open } => {
                if let Some((_, mut last)) = open {
                    last.flush()?;
                }
                println!("{}", json!({ "folder": folder, "done": done }));
                Ok(())
            }
        }
    }
}
